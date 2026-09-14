import { useMemo, useState } from 'react';
import { Moon, PanelLeftOpen, ShieldCheck, Sun } from 'lucide-react';
import { useChatController } from './application/hooks/useChatController';
import type { QaGateway } from './application/ports/qaGateway';
import type { RuntimeConfig } from './infrastructure/config/runtimeConfig';
import { Composer } from './presentation/components/Composer';
import { MessageList } from './presentation/components/MessageList';
import { Sidebar } from './presentation/components/Sidebar';
import { Welcome } from './presentation/components/Welcome';
import { isTerminalStatus } from './domain/models';
import { AGENT_CATALOG } from './infrastructure/config/agentCatalog';
import './presentation/styles/app.css';

/**
 * 应用根组件的访问端口与运行配置。
 */
type AppProps = {
  /**
   * 问答后端访问端口。
   */
  gateway: QaGateway;
  /**
   * 前端运行配置。
   */
  config: RuntimeConfig;
};

/**
 * 组装会话侧栏、消息区和输入区，并展示当前运行环境。
 *
 * @param 参数1 解构后的组件属性，各字段含义见对应属性类型。
 *
 * @returns 函数处理结果。
 */
export const App = ({ gateway, config }: AppProps) => {
  const controller = useChatController(gateway);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const [draft, setDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const hasMessages = controller.state.messages.length > 0;
  const activeAnswerId = useMemo(
    () =>
      [...controller.state.messages]
        .reverse()
        .find((message) => message.answerId && !isTerminalStatus(message.answerStatus))?.answerId ??
      undefined,
    [controller.state.messages],
  );
  const statusLabel = useMemo(() => {
    if (config.environment === 'production') return '生产环境';
    if (config.environment === 'test') return '测试环境';
    return '开发环境';
  }, [config.environment]);
  const topbarTitle = controller.activeConversation?.title ?? '智浦小鹿工作台';

  return (
    <div className="app" data-theme={theme}>
      {sidebarOpen && (
        <Sidebar
          conversations={controller.state.conversations}
          activeChatId={controller.state.activeChatId}
          open
          persistent
          onClose={() => setSidebarOpen(false)}
          onNewChat={controller.newChat}
          onSelect={(chatId) => {
            void controller.selectChat(chatId);
          }}
          onRename={(chatId, title) => void controller.renameChat(chatId, title)}
          onDelete={(chatId) => void controller.deleteChat(chatId)}
          hasMore={controller.state.hasMoreConversations}
          loadingMore={controller.state.loadingMoreConversations}
          onLoadMore={() => void controller.loadMoreConversations()}
        />
      )}

      <main className={`main-panel ${hasMessages ? 'main-panel--active' : 'main-panel--empty'}`}>
        <header className="topbar">
          {!sidebarOpen && (
            <button
              className="icon-button sidebar__open"
              aria-label="打开侧边栏"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
          <div className="topbar__title">
            <strong title={topbarTitle}>{topbarTitle}</strong>
            <span>
              <ShieldCheck size={13} /> 知识库与业务数据双通道核验
            </span>
          </div>
          <div className="topbar__actions">
            <span className="environment-badge">{statusLabel}</span>
            <button
              className="icon-button"
              aria-label={theme === 'light' ? '切换为深色模式' : '切换为浅色模式'}
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </header>

        {controller.state.loading ? (
          <div className="chat-canvas">
            <div className="page-loading" role="status">
              <span className="loading-ring" /> 正在加载聊天
            </div>
          </div>
        ) : hasMessages ? (
          <div className="chat-canvas chat-canvas--active">
            <MessageList
              messages={controller.state.messages}
              onStop={(answerId) => void controller.stopAnswer(answerId)}
              onRegenerate={(answerId) => void controller.regenerate(answerId)}
              onFeedback={(answerId, value) => void controller.feedback(answerId, value)}
            />
          </div>
        ) : (
          <div className="workspace-home">
            <Welcome onSuggestion={setDraft}>
              <Composer
                agents={AGENT_CATALOG}
                activeAgentType={controller.activeAgentType}
                onAgentChange={controller.selectAgent}
                showAgentSelector={controller.state.activeChatId === null}
                activeAnswerId={activeAnswerId}
                disabled={controller.state.loading || controller.state.sending}
                maxCharacters={config.maxQuestionCharacters}
                value={draft}
                onChange={setDraft}
                onStop={(answerId) => void controller.stopAnswer(answerId)}
                onSubmit={(question) => {
                  setDraft('');
                  void controller.sendQuestion(question);
                }}
              />
            </Welcome>
          </div>
        )}

        {controller.state.error && (
          <div className="global-error" role="alert">
            <span>{controller.state.error}</span>
            <button onClick={controller.clearError}>关闭</button>
          </div>
        )}

        {(hasMessages || controller.state.loading) && (
          <Composer
            agents={AGENT_CATALOG}
            activeAgentType={controller.activeAgentType}
            onAgentChange={controller.selectAgent}
            showAgentSelector={controller.state.activeChatId === null}
            activeAnswerId={activeAnswerId}
            disabled={controller.state.loading || controller.state.sending}
            maxCharacters={config.maxQuestionCharacters}
            value={draft}
            onChange={setDraft}
            onStop={(answerId) => void controller.stopAnswer(answerId)}
            onSubmit={(question) => {
              setDraft('');
              void controller.sendQuestion(question);
            }}
          />
        )}
      </main>
    </div>
  );
};
