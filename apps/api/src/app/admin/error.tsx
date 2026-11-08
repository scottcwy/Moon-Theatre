'use client';

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="panel" role="alert"><h1>页面暂时无法加载</h1><p>请求未完成，请重新尝试。若登录已失效，请返回登录页；持续失败时请联系服务器维护人员。</p><div className="error-actions"><button type="button" onClick={reset}>重新尝试</button><a href="/admin/login">返回登录</a></div></section>;
}
