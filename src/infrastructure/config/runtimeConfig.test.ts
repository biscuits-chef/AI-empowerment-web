import { describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfig, parseRuntimeConfig } from './runtimeConfig';

const xml = `<?xml version="1.0"?><application>
  <environment>test</environment><apiBaseUrl>/api/v1/</apiBaseUrl>
  <requestTimeoutMillis>8000</requestTimeoutMillis>
  <streamIdleTimeoutMillis>130000</streamIdleTimeoutMillis>
  <maxQuestionCharacters>4000</maxQuestionCharacters>
</application>`;

describe('runtimeConfig', () => {
  it('解析并规范化 XML 配置', () => {
    expect(parseRuntimeConfig(xml)).toEqual({
      environment: 'test',
      apiBaseUrl: '/api/v1',
      requestTimeoutMillis: 8000,
      streamIdleTimeoutMillis: 130000,
      maxQuestionCharacters: 4000,
    });
  });

  it.each([
    ['<application>', '格式无效'],
    [xml.replace('<environment>test</environment>', ''), '缺少 environment'],
    [xml.replace('test', 'staging'), 'environment 必须'],
    [xml.replace('/api/v1/', 'http://unsafe.example'), 'apiBaseUrl'],
    [xml.replace('8000', 'zero'), '正整数'],
  ])('拒绝不安全或无效配置', (input, expected) => {
    expect(() => parseRuntimeConfig(input)).toThrow(expected);
  });

  it('从固定路径加载且禁用缓存', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(xml));
    await expect(loadRuntimeConfig()).resolves.toMatchObject({ environment: 'test' });
    expect(fetchMock).toHaveBeenCalledWith('/config/application.xml', { cache: 'no-store' });
  });

  it('配置请求失败时给出错误', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    await expect(loadRuntimeConfig()).rejects.toThrow('无法加载');
  });
});
