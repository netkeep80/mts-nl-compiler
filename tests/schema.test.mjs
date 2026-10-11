import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const open = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(read("../db/schema.sql"));
  return db;
};

test("ровно две таблицы данных: links и strings", () => {
  const db = open();
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all().map((row) => row.name);
    assert.deepEqual(names, ["links", "strings"]);
  } finally {
    db.close();
  }
});

test("Git-источники реконструируют обе таблицы без скрытых смысловых типов", () => {
  const links = JSON.parse(read("../data/links.json"));
  const strings = JSON.parse(read("../data/strings.json"));
  assert.ok(Array.isArray(links));
  assert.ok(Array.isArray(strings));
  const db = open();
  try {
    const insertLink = db.prepare('INSERT INTO links (link, "begin", "end", weight) VALUES (?, ?, ?, ?)');
    const insertString = db.prepare('INSERT INTO strings (link, string) VALUES (?, ?)');
    for (const row of strings) {
      assert.deepEqual(Object.keys(row).sort(), ["link", "string"]);
      insertString.run(row.link, row.string);
    }
    for (const row of links) {
      assert.deepEqual(Object.keys(row).sort(), ["begin", "end", "link", "weight"]);
      insertLink.run(row.link, row.begin, row.end, row.weight);
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM links").get().n, links.length);
    assert.equal(db.prepare("SELECT count(*) AS n FROM strings").get().n, strings.length);
  } finally {
    db.close();
  }
});

test("строки, рекурсивные ссылки и допустимые веса хранятся без предметных таблиц", () => {
  const db = open();
  try {
    db.prepare("INSERT INTO strings (link, string) VALUES (?, ?)")
      .run("s:1", "требование");
    const put = db.prepare('INSERT INTO links (link, "begin", "end", weight) VALUES (?, ?, ?, ?)');
    put.run("l:1", "s:1", "s:1", 0.75);
    put.run("l:2", "l:1", "s:1", 1.0);
    const result = db.prepare('SELECT "begin" AS source, "end" AS target, weight FROM links WHERE link = ?')
      .get("l:2");
    assert.equal(result.source, "l:1");
    assert.equal(result.target, "s:1");
    assert.equal(result.weight, 1);
    assert.throws(() => put.run("l:3", "s:1", "s:1", -0.01));
    assert.throws(() => put.run("l:3", "s:1", "s:1", 1.01));
    assert.throws(() => put.run("l:1", "s:1", "s:1", 0.1));
  } finally {
    db.close();
  }
});
