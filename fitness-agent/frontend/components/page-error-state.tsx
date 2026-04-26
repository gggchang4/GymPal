interface PageErrorStateProps {
  title: string;
  message?: string;
}

function normalizeErrorMessage(message?: string) {
  if (!message) {
    return "页面数据暂时不可用，请稍后重试。";
  }

  if (message.includes("Unable to reach the backend API")) {
    return "后端服务暂时不可用，当前页面无法加载最新数据。";
  }

  if (message.includes("Request failed with status 401") || message.includes("Missing bearer token")) {
    return "当前登录状态已失效，请重新登录后再试。";
  }

  return message;
}

export function PageErrorState({ title, message }: PageErrorStateProps) {
  return (
    <div className="page">
      <div className="page-header-compact">
        <div>
          <span className="section-label">页面</span>
          <h2>{title}</h2>
        </div>
        <span className="mini-chip">暂时不可用</span>
      </div>

      <section className="form-panel">
        <div className="section-copy">
          <span className="section-label">状态</span>
          <h3>加载失败</h3>
          <p className="muted">{normalizeErrorMessage(message)}</p>
          <p className="muted">导航已经恢复可用，你可以稍后重新进入这个页面继续操作。</p>
        </div>
      </section>
    </div>
  );
}
