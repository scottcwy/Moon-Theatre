export default function ConsoleLoading() {
  return <section className="loading-state" role="status" aria-live="polite" aria-busy="true"><h1>正在加载</h1><p className="muted">正在验证访问权限并读取最新数据，请稍候。</p><div aria-hidden="true"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div></section>;
}
