import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Node } from "web-tree-sitter";

const GRAMMARS = path.join(path.dirname(fileURLToPath(import.meta.url)), "grammars");

export type TreeSitterSession = {
  parser: Parser;
  javascript: Language;
  typescript: Language;
  tsx: Language;
  python: Language;
};

let loadOnce: Promise<TreeSitterSession> | undefined;

function resolveWasm(file: string): string {
  const local = path.join(GRAMMARS, file);
  if (existsSync(local)) return local;
  throw new Error(`tree-sitter wasm missing: ${file}`);
}

async function initSession(): Promise<TreeSitterSession> {
  const runtime = resolveWasm("web-tree-sitter.wasm");
  await Parser.init({
    locateFile: (scriptName: string) => {
      if (scriptName.endsWith(".wasm")) return runtime;
      return scriptName;
    },
  });
  const javascript = await Language.load(resolveWasm("tree-sitter-javascript.wasm"));
  const typescript = await Language.load(resolveWasm("tree-sitter-typescript.wasm"));
  const tsx = await Language.load(resolveWasm("tree-sitter-tsx.wasm"));
  const python = await Language.load(resolveWasm("tree-sitter-python.wasm"));
  return { parser: new Parser(), javascript, typescript, tsx, python };
}

export function loadTreeSitter(): Promise<TreeSitterSession> {
  if (!loadOnce) loadOnce = initSession();
  return loadOnce;
}

function extOf(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot).toLowerCase();
}

function languageFor(filePath: string, session: TreeSitterSession): Language | undefined {
  switch (extOf(filePath)) {
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return session.javascript;
    case ".ts":
      return session.typescript;
    case ".tsx":
      return session.tsx;
    case ".py":
      return session.python;
    default:
      return undefined;
  }
}

function unquote(text: string): string {
  if (text.length >= 2) {
    const a = text[0];
    const b = text[text.length - 1];
    if ((a === '"' || a === "'" || a === "`") && a === b) return text.slice(1, -1);
  }
  return text;
}

function specsFromJs(root: Node): string[] {
  const specs: string[] = [];
  for (const node of root.descendantsOfType(["import_statement", "export_statement"])) {
    const src = node.childForFieldName("source");
    if (src) specs.push(unquote(src.text));
  }
  for (const node of root.descendantsOfType("call_expression")) {
    const fn = node.childForFieldName("function");
    if (fn?.text !== "require") continue;
    const args = node.childForFieldName("arguments");
    const str = args?.namedChildren.find((c) => c.type === "string");
    if (str) specs.push(unquote(str.text));
  }
  return specs;
}

function specsFromPy(root: Node): string[] {
  const specs: string[] = [];
  for (const node of root.descendantsOfType("import_from_statement")) {
    const mod = node.childForFieldName("module_name");
    if (mod) specs.push(mod.text);
  }
  for (const node of root.descendantsOfType("import_statement")) {
    for (const name of node.childrenForFieldName("name")) {
      if (name.type === "aliased_import") {
        const inner = name.childForFieldName("name");
        if (inner) specs.push(inner.text);
      } else {
        specs.push(name.text);
      }
    }
  }
  return specs;
}

export function extractSpecifiersTreeSitter(
  session: TreeSitterSession,
  filePath: string,
  source: string,
): string[] {
  const language = languageFor(filePath, session);
  if (!language) return [];
  session.parser.setLanguage(language);
  session.parser.reset();
  const tree = session.parser.parse(source);
  if (!tree) throw new Error("tree-sitter parse returned null");
  try {
    return extOf(filePath) === ".py" ? specsFromPy(tree.rootNode) : specsFromJs(tree.rootNode);
  } finally {
    tree.delete();
  }
}
