/**
 * 只读检查 TypeScript 声明级中文注释；不自动生成描述，不修改源代码。
 * 匿名回调不单独检查，命名函数及回调类型字段的参数必须说明。
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** 匹配中文说明文字。 */
const chinese = /[\u4e00-\u9fff]/;
/** 累积所有遗漏，确保一次检查能够报告全部位置。 */
const failures = [];

/**
 * 提取紧邻声明的最后一个文档注释，避免借用之前声明的注释。
 * @param node 待检查语法节点。
 * @param sourceFile 当前源文件语法树。
 * @param source 当前源文件文本。
 * @returns 声明自己的文档注释，缺失时返回空字符串。
 */
const documentation = (node, sourceFile, source) => {
  const trivia = source.slice(node.getFullStart(), node.getStart(sourceFile));
  return /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*$/.exec(trivia)?.[0] ?? '';
};

/**
 * 为简单参数及解构参数生成稳定的注释标签名称。
 * @param parameters 函数参数节点列表。
 * @returns 参数名列表；解构字段的业务说明由属性类型承载。
 */
const parameterNames = (parameters) =>
  parameters.map((parameter, index) =>
    ts.isIdentifier(parameter.name) ? parameter.name.text : `参数${index + 1}`,
  );

/**
 * 识别独立命名箭头函数及 useCallback 包装的命名函数。
 * @param node 变量声明语句。
 * @returns 命名函数节点，不匹配时返回 null。
 */
const namedFunction = (node) => {
  if (!ts.isVariableStatement(node) || node.declarationList.declarations.length !== 1) return null;
  let value = node.declarationList.declarations[0].initializer;
  if (value && ts.isCallExpression(value) && value.expression.getText() === 'useCallback') {
    value = value.arguments[0];
  }
  return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? value : null;
};

/**
 * 提取声明要求，类型和字段必须有说明，函数还必须说明参数和返回值。
 * @param node 待检查的语法节点。
 * @returns 注释契约；不属于检查范围时返回 null。
 */
const contractFor = (node) => {
  if (
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isEnumMember(node)
  ) {
    return { parameters: [], returnsValue: false };
  }
  if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) {
    const type = node.type && ts.isFunctionTypeNode(node.type) ? node.type : null;
    return {
      parameters: type ? parameterNames(type.parameters) : [],
      returnsValue: type ? type.type.kind !== ts.SyntaxKind.VoidKeyword : false,
    };
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return {
      parameters: parameterNames(node.parameters),
      returnsValue:
        !ts.isConstructorDeclaration(node) &&
        !ts.isSetAccessorDeclaration(node) &&
        node.type?.kind !== ts.SyntaxKind.VoidKeyword,
    };
  }
  const callable = namedFunction(node);
  return callable
    ? {
        parameters: parameterNames(callable.parameters),
        returnsValue: callable.type?.kind !== ts.SyntaxKind.VoidKeyword,
      }
    : null;
};

/**
 * 验证一处声明的中文说明和每个参数、返回值标签。
 * @param contract 声明要求的注释契约。
 * @param doc 声明文档注释。
 * @param location 源文件与行号。
 */
const validate = (contract, doc, location) => {
  if (!chinese.test(doc)) failures.push(`${location} 缺少中文 TSDoc`);
  for (const name of contract.parameters) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tag = new RegExp(`@param\\s+${escapedName}\\s+[^\\r\\n]*[\\u4e00-\\u9fff]`);
    if (!tag.test(doc)) failures.push(`${location} 入参 ${name} 缺少中文 @param`);
  }
  if (contract.returnsValue && !/@returns?\s+[^\r\n]*[\u4e00-\u9fff]/.test(doc)) {
    failures.push(`${location} 缺少中文 @returns`);
  }
};

/**
 * 检查单个源文件的语法和全部声明。
 * @param file 待检查文件路径。
 */
const inspectFile = (file) => {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length) {
    failures.push(`${file} 无法完整解析，不能跳过注释检查`);
    return;
  }
  /**
   * 深度遍历语法节点并校验声明。
   * @param node 当前语法节点。
   */
  const visit = (node) => {
    const contract = contractFor(node);
    if (contract) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      validate(contract, documentation(node, sourceFile, source), `${file}:${line}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
};

/**
 * 遍历生产与测试 TypeScript 文件，保留框架类型引用文件的原始语法。
 * @param directory 待扫描目录。
 */
const walk = (directory) => {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.(ts|tsx)$/.test(entry.name) && entry.name !== 'vite-env.d.ts') inspectFile(target);
  });
};

walk(path.resolve('src'));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
