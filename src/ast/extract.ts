import type Parser from 'web-tree-sitter';
import type { SymbolInput, SymbolRefInput } from '../store/symbols.js';
import type { SupportedLang } from './parser.js';

export interface ExtractedFileAst {
  symbols: SymbolInput[];
  refs: SymbolRefInput[];
  lineCount: number;
}

type SyntaxNode = Parser.SyntaxNode;

const IGNORE_REFS = new Set([
  'console',
  'Math',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Promise',
  'Error',
  'Map',
  'Set',
  'Date',
  'JSON',
  'Buffer',
  'void',
  'string',
  'number',
  'boolean',
  'any',
  'unknown',
  'never',
  'object',
  'Task',
  'List',
  'Dictionary',
  'IEnumerable',
  'IReadOnlyList',
  'Console',
  'Exception',
  'Guid',
  'DateTime',
]);

/**
 * Parses `source` with `parser` and extracts symbols + call/type references.
 * Always deletes the native WASM syntax tree in `finally`.
 */
export function extractFileAst(
  lang: SupportedLang,
  source: string,
  parser: Parser,
): ExtractedFileAst {
  const normalizedSource = source.replace(/\r\n/g, '\n');
  const lines = normalizedSource.split('\n');
  const tree = parser.parse(normalizedSource);

  try {
    const symbols: SymbolInput[] = [];
    const refs: SymbolRefInput[] = [];
    const seenRefs = new Set<string>();

    const addRef = (name: string | undefined, node: SyntaxNode) => {
      if (!name || name.length <= 1 || IGNORE_REFS.has(name)) return;
      const lineNo = node.startPosition.row + 1;
      const colNo = node.startPosition.column + 1;
      const key = `${name}:${lineNo}:${colNo}`;
      if (seenRefs.has(key)) return;
      seenRefs.add(key);
      refs.push({
        symbolName: name,
        lineNo,
        colNo,
        snippet: (lines[node.startPosition.row] ?? '').trim().slice(0, 160),
      });
    };

    if (lang === 'csharp') {
      walkCSharp(tree.rootNode, lines, undefined, symbols, addRef);
    } else if (lang === 'python') {
      walkPython(tree.rootNode, lines, undefined, symbols, addRef);
    } else {
      walkTypeScript(tree.rootNode, lines, undefined, false, symbols, addRef);
    }

    return {
      symbols,
      refs,
      lineCount: lines.length,
    };
  } finally {
    tree.delete();
  }
}

function makeSignature(node: SyntaxNode, lines: string[]): string {
  const firstLine = (lines[node.startPosition.row] ?? '').trim();
  const cleaned = firstLine.replace(/\{\s*$/, '').trim();
  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}...` : cleaned;
}

function getFieldText(node: SyntaxNode, field: string): string | undefined {
  return node.childForFieldName(field)?.text;
}

function walkTypeScript(
  node: SyntaxNode,
  lines: string[],
  parentQualified: string | undefined,
  parentExported: boolean,
  symbols: SymbolInput[],
  addRef: (name: string | undefined, node: SyntaxNode) => void,
): void {
  const t = node.type;

  if (t === 'export_statement') {
    for (const child of node.namedChildren) {
      walkTypeScript(child, lines, parentQualified, true, symbols, addRef);
    }
    return;
  }

  if (
    t === 'function_declaration' ||
    t === 'class_declaration' ||
    t === 'abstract_class_declaration' ||
    t === 'interface_declaration' ||
    t === 'type_alias_declaration' ||
    t === 'enum_declaration'
  ) {
    const name = getFieldText(node, 'name');
    if (name) {
      const kind = t
        .replace('abstract_class_declaration', 'class')
        .replace('_declaration', '')
        .replace('type_alias', 'type');
      const qualifiedName = parentQualified ? `${parentQualified}.${name}` : name;
      symbols.push({
        name,
        qualifiedName,
        kind,
        signature: makeSignature(node, lines),
        isExported: parentExported,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        parentQualifiedName: parentQualified,
      });

      const body = node.childForFieldName('body');
      if (body) {
        walkTypeScript(body, lines, qualifiedName, false, symbols, addRef);
      }
      // Also collect type references on heritage/params outside body.
      for (const child of node.namedChildren) {
        if (child !== body && child.type !== 'type_identifier' && child.type !== 'identifier') {
          walkTypeScriptRefsOnly(child, addRef);
        }
      }
      return;
    }
  }

  if (t === 'method_definition' || t === 'method_signature') {
    const name = getFieldText(node, 'name');
    if (name) {
      const qualifiedName = parentQualified ? `${parentQualified}.${name}` : name;
      symbols.push({
        name,
        qualifiedName,
        kind: 'method',
        signature: makeSignature(node, lines),
        isExported: false,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        parentQualifiedName: parentQualified,
      });
      const body = node.childForFieldName('body');
      if (body) walkTypeScriptRefsOnly(body, addRef);
      const params = node.childForFieldName('parameters');
      if (params) walkTypeScriptRefsOnly(params, addRef);
      return;
    }
  }

  if (
    (t === 'lexical_declaration' || t === 'variable_declaration') &&
    !parentQualified
  ) {
    for (const decl of node.namedChildren) {
      if (decl.type !== 'variable_declarator') continue;
      const nameNode = decl.childForFieldName('name');
      const valNode = decl.childForFieldName('value');
      if (
        nameNode &&
        valNode &&
        (valNode.type === 'arrow_function' || valNode.type === 'function_expression')
      ) {
        const name = nameNode.text;
        symbols.push({
          name,
          qualifiedName: name,
          kind: 'function',
          signature: makeSignature(node, lines),
          isExported: parentExported,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
        walkTypeScriptRefsOnly(valNode, addRef);
      } else if (valNode) {
        walkTypeScriptRefsOnly(valNode, addRef);
      }
    }
    return;
  }

  if (t === 'call_expression') {
    const fn = node.childForFieldName('function');
    if (fn) {
      const refName =
        fn.type === 'member_expression'
          ? fn.childForFieldName('property')?.text
          : fn.text;
      addRef(refName, fn);
    }
  } else if (t === 'new_expression') {
    const ctor = node.childForFieldName('constructor');
    if (ctor) {
      const refName =
        ctor.type === 'member_expression'
          ? ctor.childForFieldName('property')?.text
          : ctor.text;
      addRef(refName, ctor);
    }
  } else if (t === 'type_identifier') {
    addRef(node.text, node);
  } else if (t === 'jsx_opening_element' || t === 'jsx_self_closing_element') {
    const tag = node.childForFieldName('name');
    if (tag && /^[A-Z]/.test(tag.text)) {
      addRef(tag.text, tag);
    }
  }

  for (const child of node.namedChildren) {
    walkTypeScript(child, lines, parentQualified, false, symbols, addRef);
  }
}

function walkTypeScriptRefsOnly(
  node: SyntaxNode,
  addRef: (name: string | undefined, node: SyntaxNode) => void,
): void {
  const t = node.type;
  if (t === 'call_expression') {
    const fn = node.childForFieldName('function');
    if (fn) {
      const refName =
        fn.type === 'member_expression'
          ? fn.childForFieldName('property')?.text
          : fn.text;
      addRef(refName, fn);
    }
  } else if (t === 'new_expression') {
    const ctor = node.childForFieldName('constructor');
    if (ctor) {
      const refName =
        ctor.type === 'member_expression'
          ? ctor.childForFieldName('property')?.text
          : ctor.text;
      addRef(refName, ctor);
    }
  } else if (t === 'type_identifier') {
    addRef(node.text, node);
  } else if (t === 'jsx_opening_element' || t === 'jsx_self_closing_element') {
    const tag = node.childForFieldName('name');
    if (tag && /^[A-Z]/.test(tag.text)) {
      addRef(tag.text, tag);
    }
  }
  for (const child of node.namedChildren) {
    walkTypeScriptRefsOnly(child, addRef);
  }
}

function hasPublicOrInternalModifier(node: SyntaxNode): boolean {
  for (const child of node.namedChildren) {
    if (child.type === 'modifier') {
      const text = child.text;
      if (text === 'public' || text === 'internal') return true;
    }
  }
  return false;
}

function walkCSharp(
  node: SyntaxNode,
  lines: string[],
  parentQualified: string | undefined,
  symbols: SymbolInput[],
  addRef: (name: string | undefined, node: SyntaxNode) => void,
): void {
  const t = node.type;

  if (
    t === 'class_declaration' ||
    t === 'interface_declaration' ||
    t === 'struct_declaration' ||
    t === 'record_declaration' ||
    t === 'enum_declaration'
  ) {
    const name = getFieldText(node, 'name');
    if (name) {
      const kind = t.replace('_declaration', '');
      const qualifiedName = parentQualified ? `${parentQualified}.${name}` : name;
      symbols.push({
        name,
        qualifiedName,
        kind,
        signature: makeSignature(node, lines),
        isExported: hasPublicOrInternalModifier(node),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        parentQualifiedName: parentQualified,
      });
      const body = node.childForFieldName('body');
      if (body) {
        walkCSharp(body, lines, qualifiedName, symbols, addRef);
      }
      for (const child of node.namedChildren) {
        if (child !== body && child.type === 'base_list') {
          walkCSharpRefsOnly(child, addRef);
        }
      }
      return;
    }
  }

  if (
    t === 'method_declaration' ||
    t === 'constructor_declaration' ||
    t === 'property_declaration'
  ) {
    const name = getFieldText(node, 'name');
    if (name) {
      const kind =
        t === 'method_declaration'
          ? 'method'
          : t === 'constructor_declaration'
            ? 'constructor'
            : 'property';
      const qualifiedName = parentQualified ? `${parentQualified}.${name}` : name;
      symbols.push({
        name,
        qualifiedName,
        kind,
        signature: makeSignature(node, lines),
        isExported: hasPublicOrInternalModifier(node),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        parentQualifiedName: parentQualified,
      });
      const body = node.childForFieldName('body');
      if (body) {
        walkCSharpRefsOnly(body, addRef);
      }
      const params = node.childForFieldName('parameters');
      if (params) {
        walkCSharpRefsOnly(params, addRef);
      }
      return;
    }
  }

  if (t === 'invocation_expression') {
    const fn = node.childForFieldName('function');
    if (fn) {
      const refName =
        fn.type === 'member_access_expression'
          ? fn.childForFieldName('name')?.text
          : fn.text;
      addRef(refName, fn);
    }
  } else if (t === 'object_creation_expression') {
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      addRef(typeNode.text, typeNode);
    }
  }

  for (const child of node.namedChildren) {
    walkCSharp(child, lines, parentQualified, symbols, addRef);
  }
}

function walkCSharpRefsOnly(
  node: SyntaxNode,
  addRef: (name: string | undefined, node: SyntaxNode) => void,
): void {
  const t = node.type;
  if (t === 'invocation_expression') {
    const fn = node.childForFieldName('function');
    if (fn) {
      const refName =
        fn.type === 'member_access_expression'
          ? fn.childForFieldName('name')?.text
          : fn.text;
      addRef(refName, fn);
    }
  } else if (t === 'object_creation_expression') {
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      addRef(typeNode.text, typeNode);
    }
  } else if (t === 'identifier' && node.parent?.type === 'parameter') {
    // Only type annotations, not parameter names.
    if (node === node.parent.childForFieldName('type')) {
      addRef(node.text, node);
    }
  } else if (
    t === 'identifier' &&
    (node.parent?.type === 'base_list' || node.parent?.type === 'simple_base_type')
  ) {
    addRef(node.text, node);
  }

  for (const child of node.namedChildren) {
    walkCSharpRefsOnly(child, addRef);
  }
}

function walkPython(
  node: SyntaxNode,
  lines: string[],
  parentQualified: string | undefined,
  symbols: SymbolInput[],
  addRef: (name: string | undefined, node: SyntaxNode) => void,
): void {
  const t = node.type;

  if (t === 'class_definition') {
    const name = getFieldText(node, 'name');
    if (name) {
      const qualifiedName = parentQualified ? `${parentQualified}.${name}` : name;
      symbols.push({
        name,
        qualifiedName,
        kind: 'class',
        signature: makeSignature(node, lines),
        isExported: !name.startsWith('_'),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        parentQualifiedName: parentQualified,
      });
      const body = node.childForFieldName('body');
      if (body) walkPython(body, lines, qualifiedName, symbols, addRef);
      return;
    }
  }

  if (t === 'function_definition') {
    const name = getFieldText(node, 'name');
    if (name) {
      const qualifiedName = parentQualified ? `${parentQualified}.${name}` : name;
      symbols.push({
        name,
        qualifiedName,
        kind: parentQualified ? 'method' : 'function',
        signature: makeSignature(node, lines),
        isExported: !parentQualified && !name.startsWith('_'),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        parentQualifiedName: parentQualified,
      });
      const body = node.childForFieldName('body');
      if (body) walkPythonRefsOnly(body, addRef);
      const params = node.childForFieldName('parameters');
      if (params) walkPythonRefsOnly(params, addRef);
      return;
    }
  }

  if (t === 'call') {
    const fn = node.childForFieldName('function');
    if (fn) {
      const refName =
        fn.type === 'attribute' ? fn.childForFieldName('attribute')?.text : fn.text;
      addRef(refName, fn);
    }
  }

  for (const child of node.namedChildren) {
    walkPython(child, lines, parentQualified, symbols, addRef);
  }
}

function walkPythonRefsOnly(
  node: SyntaxNode,
  addRef: (name: string | undefined, node: SyntaxNode) => void,
): void {
  if (node.type === 'call') {
    const fn = node.childForFieldName('function');
    if (fn) {
      const refName =
        fn.type === 'attribute' ? fn.childForFieldName('attribute')?.text : fn.text;
      addRef(refName, fn);
    }
  }
  for (const child of node.namedChildren) {
    walkPythonRefsOnly(child, addRef);
  }
}

/**
 * Extracts Markdown heading sections (`#`..`######`) outside fenced code blocks
 * as navigable `section` symbols with exact `startLine..endLine` spans.
 */
export function extractMarkdown(source: string): ExtractedFileAst {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const symbols: SymbolInput[] = [];
  const stack: Array<{ level: number; sym: SymbolInput }> = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (!match) continue;

    const level = match[1].length;
    const title = match[2];
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()!.sym.endLine = lineNo - 1;
    }

    const sym: SymbolInput = {
      name: title,
      qualifiedName: title,
      kind: 'section',
      signature: trimmed.slice(0, 160),
      isExported: level <= 2,
      startLine: lineNo,
      endLine: lines.length,
    };
    symbols.push(sym);
    stack.push({ level, sym });
  }

  return { symbols, refs: [], lineCount: lines.length };
}
