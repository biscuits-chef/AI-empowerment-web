import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadRuntimeConfig } from './infrastructure/config/runtimeConfig';
import { HttpQaGateway } from './infrastructure/http/httpQaGateway';
import { ApplicationErrorBoundary } from './presentation/components/ApplicationErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('应用挂载节点不存在');
const root = createRoot(rootElement);

// 运行配置校验失败时不连接后端，避免带着错误环境地址继续工作。
void loadRuntimeConfig()
  .then((config) => {
    root.render(
      <StrictMode>
        <ApplicationErrorBoundary>
          <App config={config} gateway={new HttpQaGateway(config)} />
        </ApplicationErrorBoundary>
      </StrictMode>,
    );
  })
  .catch(() => {
    root.render(
      <main className="bootstrap-error">
        <h1>应用暂时无法启动</h1>
        <p>前端运行配置未正确加载，请联系系统管理员。</p>
      </main>,
    );
  });
