/**
 * 表格损坏时的**自动降级提示条**（M4-10 接线；《M4 界面稿》§2.10）。
 *
 * 界面稿原文要求：正文区顶部一条 `WarnBox`（危险态）写明"表格结构无法解析，已按普通笔记打开；
 * 原文未改动" + 「查看原文」+「下载当前内容」。
 *
 * 两处按仓库现状落：①`WarnBox` 这个组件不存在（`components.md` §15.2 已登记），
 * 用既有的 `.banner--danger`（红色常驻横幅，`DESIGN.md` 里就是"破坏性/阻塞性后果必须可见"的载体）；
 * ②**不静默改数据**——这一条只**告知**与**给出路**，不写任何东西到库里。
 */
import { Button } from "../../../app/ui/Controls";

export interface TableDegradeNoticeProps {
  /** 「查看原文」：切到仅编辑（原文是 Markdown，用户能自己复制走） */
  onViewSource: () => void;
  /** 「下载当前内容」：把未改动的原文存成文件 */
  onDownload: () => void;
}

export function TableDegradeNotice({ onViewSource, onDownload }: TableDegradeNoticeProps) {
  return (
    <div className="banner banner--danger" role="alert">
      <span>表格结构无法解析，已按普通笔记打开；原文未改动</span>
      <Button variant="secondary" size="sm" onClick={onViewSource}>
        查看原文
      </Button>
      <Button variant="secondary" size="sm" onClick={onDownload}>
        下载当前内容
      </Button>
    </div>
  );
}
