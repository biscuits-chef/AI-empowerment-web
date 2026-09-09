/**
 * 部署时由 XML 文件注入、无需重新构建前端的运行配置。
 */
export type RuntimeConfig = {
  /**
   * 运行环境。
   */
  environment: 'development' | 'test' | 'production';
  /**
   * 后端接口基础地址。
   */
  apiBaseUrl: string;
  /**
   * 普通请求超时时间（毫秒）。
   */
  requestTimeoutMillis: number;
  /**
   * 流式空闲超时时间（毫秒）。
   */
  streamIdleTimeoutMillis: number;
  /**
   * 问题最大字符数。
   */
  maxQuestionCharacters: number;
};

/**
 * 读取必填 XML 配置文本，缺失或空白时阻止应用启动。
 *
 * @param document XML 文档对象。
 *
 * @param tagName XML 标签名称。
 *
 * @returns 函数处理结果。
 */
const requiredText = (document: Document, tagName: string): string => {
  const value = document.querySelector(tagName)?.textContent?.trim();
  if (!value) throw new Error(`运行配置缺少 ${tagName}`);
  return value;
};

/**
 * 将配置文本转换为安全范围内的正整数。
 *
 * @param value 输入值。
 *
 * @param field 字段名称。
 *
 * @returns 函数处理结果。
 */
const positiveInteger = (value: string, field: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${field} 必须是正整数`);
  return parsed;
};

/**
 * 解析并校验前端 XML 运行配置，非法地址和无界数值会阻止应用启动。
 *
 * @param xml XML 配置文本。
 *
 * @returns 函数处理结果。
 */
export const parseRuntimeConfig = (xml: string): RuntimeConfig => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('运行配置 XML 格式无效');
  const environment = requiredText(document, 'environment');
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error('environment 必须是 development、test 或 production');
  }
  const apiBaseUrl = requiredText(document, 'apiBaseUrl');
  if (!apiBaseUrl.startsWith('/') && !apiBaseUrl.startsWith('https://')) {
    throw new Error('apiBaseUrl 只能使用同源路径或 HTTPS 地址');
  }
  return {
    environment: environment as RuntimeConfig['environment'],
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
    requestTimeoutMillis: positiveInteger(
      requiredText(document, 'requestTimeoutMillis'),
      'requestTimeoutMillis',
    ),
    streamIdleTimeoutMillis: positiveInteger(
      requiredText(document, 'streamIdleTimeoutMillis'),
      'streamIdleTimeoutMillis',
    ),
    maxQuestionCharacters: positiveInteger(
      requiredText(document, 'maxQuestionCharacters'),
      'maxQuestionCharacters',
    ),
  };
};

/**
 * 从同源静态资源加载运行配置，并显式禁止浏览器缓存。
 *
 * @returns 函数处理结果。
 */
export const loadRuntimeConfig = async (): Promise<RuntimeConfig> => {
  const response = await fetch('/config/application.xml', { cache: 'no-store' });
  if (!response.ok) throw new Error('无法加载前端运行配置');
  return parseRuntimeConfig(await response.text());
};
