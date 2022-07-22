const https = require("https");
const AWS = require("aws-sdk");
const dynamo = new AWS.DynamoDB.DocumentClient();
const zlib = require("zlib");
const table_name = ""; // Nombre de la tabla DynamoDB
let token_ram = {};
let ip_baned = {};
let lambda_id = Math.random().toString(36).substring(2);
// Handler [No editar]
exports.handler = async (event) => {
  if (event.headers["accept-encoding"].includes("gzip")) {
    let r = await main(event);
    let status = r.status;
    r.lambda_id = lambda_id;
    if (status == 400) _ip(event.requestContext.http.sourceIp);
    if (ip_baned[event.requestContext.http.sourceIp] > 50)
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "IP baned" }),
        headers: {},
      };
    r = zlib.gzipSync(JSON.stringify(r));
    return {
      body: r.toString("base64"),
      isBase64Encoded: true,
      statusCode: status,
      headers: {
        "content-encoding": "gzip",
      },
    };
  }
};
// Main [No editar]
async function main(event) {
  let x = {
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    ip: event.requestContext.http.sourceIp,
    query:
      event.queryStringParameters === undefined
        ? {}
        : event.queryStringParameters,
    body: event.body === undefined ? "{}" : event.body,
  };
  if (x.method === "POST") return await post(x);
  if (x.method === "GET") return await get(x);
  return { status: 404, error: "Method not allowed", ip: x.ip };
}
// Get
async function get(event) {
  let level = -1;
  switch (event.path) {
    case "/api/v1/read":
      if (event.query.id === undefined)
        return { status: 404, error: "id is required" };
      if (event.query.token === undefined)
        return { status: 404, error: "token is required" };
      level = await _level(event.query.token, event.ip);
      if (level < 0 || (event.query.id[0] == "_" && level != 99))
        return { status: 405, error: "access denied" };
      return await _read(event.query.id);
    case "/api/v1/delete":
      if (event.query.id === undefined)
        return { status: 404, error: "id is required" };
      if (event.query.token === undefined)
        return { status: 404, error: "token is required" };
      level = await _level(event.query.token, event.ip);
      if (level < 0 || (event.query.id[0] == "_" && level != 99))
        return { status: 405, error: "access denied" };
      return await _delete(event.query.id);
    case "/api/v1/users_add":
      if (event.query.name === undefined)
        return { status: 404, error: "name is required" };
      if (event.query.key === undefined)
        return { status: 404, error: "key is required" };
      if (event.query.level === undefined)
        return { status: 404, error: "level is required" };
      if (event.query.token === undefined)
        return { status: 404, error: "token is required" };
      level = await _level(event.query.token, event.ip);
      if (level != 99) return { status: 405, error: "access denied" };
      return await _users_add(
        event.query.name,
        event.query.key,
        event.query.level
      );
    case "/api/v1/users_del":
      if (event.query.name === undefined)
        return { status: 404, error: "name is required" };
      level = await _level(event.query.token, event.ip);
      if (level != 99) return { status: 405, error: "access denied" };
      return await _users_del(event.query.name);
    default:
      return { status: 404, error: "Path not allowed", ip: event.ip };
  }
}
// Post
async function post(event) {
  let level = -1;
  switch (event.path) {
    case "/api/v1/save":
      if (event.query.id === undefined)
        return { status: 404, error: "id is required" };
      if (event.query.token === undefined)
        return { status: 404, error: "token is required" };
      level = await _level(event.query.token, event.ip);
      if (level < 0 || (event.query.id[0] == "_" && level != 99))
        return { status: 405, error: "access denied" };
      if (!_safe(event.body)) return { status: 404, error: "body is required" };
      return await _save(event.query.id, event.body);
    case "/api/v1/login":
      if (!_safe(event.body)) return { status: 404, error: "body is required" };
      return await _login(_safe(event.body), event.ip);
    default:
      return { status: 404, error: "Path not allowed", ip: event.ip };
  }
}
// Safe
function _safe(data) {
  try {
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}
// Save DB
async function _save(id, data) {
  try {
    return {
      status: 200,
      ...(await dynamo
        .put({
          TableName: table_name,
          Item: {
            id: id,
            data: data,
          },
        })
        .promise()),
    };
  } catch (err) {
    return { status: 404, ...err };
  }
}
// Read DB
async function _read(id) {
  try {
    let r = await dynamo
      .get({
        TableName: table_name,
        Key: {
          id: id,
        },
      })
      .promise();
    if (r.Item != undefined) r.Item.data = _safe(r.Item.data);
    return {
      status: 200,
      ...r,
    };
  } catch (err) {
    return { status: 404, ...err };
  }
}
// Delete DB
async function _delete(id) {
  try {
    return {
      status: 200,
      ...(await dynamo
        .delete({
          TableName: table_name,
          Key: {
            id: id,
          },
        })
        .promise()),
    };
  } catch (err) {
    return { status: 404, ...err };
  }
}
// IP baned
async function _ip(ip) {
  if (ip_baned[ip] == undefined) ip_baned[ip] = 0;
  ip_baned[ip]++;
}
// Login
async function _login(data, ip) {
  let country = await fetch("https://ipinfo.io/" + ip + "/country");
  if (country != "MX\n")
    return { status: 400, error: "access denied (region)", region: country };
  let users = await _read("_users");
  if (users.Item === undefined)
    return { status: 404, error: "Users not found" };
  if (data.key === undefined) return { status: 404, error: "key is required" };
  if (users.Item.data[data.key] === undefined)
    return { status: 400, error: "key not found" };
  let token =
    Math.random().toString(36).substring(2) +
    Math.random().toString(36).substring(2) +
    Math.random().toString(36).substring(2);
  delete token_ram[users.Item.data[data.key].token];
  users.Item.data[data.key].token = token;
  users.Item.data[data.key].ip = ip;
  await _save("_users", JSON.stringify(users.Item.data));
  return { status: 200, token: token };
}
// Get level
async function _level(token, ip) {
  // RAM fast cache
  if (token_ram[token] != undefined) {
    if (token_ram[token].ip == ip) {
      return token_ram[token].level;
    }
  }
  let users = await _read("_users");
  if (users.Item === undefined) return -1;
  for (let x in users.Item.data) {
    if (users.Item.data[x].token == token && users.Item.data[x].ip == ip) {
      token_ram[token] = { level: users.Item.data[x].level, ip: ip };
      return users.Item.data[x].level;
    }
  }
  return -1;
}
// Add user
async function _users_add(name, key, level) {
  let users = await _read("_users");
  if (users.Item === undefined)
    return { status: 404, error: "Users not found" };
  users.Item.data[key] = { name: name, level: level, token: "", ip: "" };
  await _save("_users", JSON.stringify(users.Item.data));
  return { status: 200 };
}
// Delete user
async function _users_del(name) {
  let users = await _read("_users");
  if (users.Item === undefined)
    return { status: 404, error: "Users not found" };
  for (let x in users.Item.data) {
    if (users.Item.data[x].name == name) {
      delete users.Item.data[x];
      await _save("_users", JSON.stringify(users.Item.data));
      return { status: 200 };
    }
  }
  return { status: 404, error: "User not found" };
}
async function fetch(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode != 200) return resolve("MX\n");
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve(data);
      });
    });
  });
}
