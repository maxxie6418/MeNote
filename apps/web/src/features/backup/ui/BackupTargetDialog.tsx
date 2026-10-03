/**
 * 外部备份目标的新建 / 编辑弹窗（M7 第 4 项 批 1；设计 §四）。
 *
 * **两个态共用一个表单**：`target === null` 是新建，否则是编辑。区别只有三处——
 * 类型不可改、凭据留空即不改、标题文案。
 *
 * ## 几条照 DESIGN.md 落的口径
 *
 * - **凭据的 label 必须说清"留空 = 不改"**（§5.4-2 的诚实性要求）。只写"密钥"两个字，
 *   用户会以为把它删掉就等于换了新密钥——实际是"保持原样"。
 * - **勾了「与本机保持一致」的风险必须平铺**，不藏进 ⓘ（§5.4-2：破坏性后果不得折叠）。
 * - **提交不禁用**，校验没过就地报错（§6.1）。
 * - **零新增 CSS**：全部用既有 `field` / `setrow` / `segmented` / `hint-line`。
 */
import { useState } from "react";
import {
  BackupSchedules,
  BackupTargetKinds,
  type BackupDeletePolicy,
  type BackupSchedule,
  type BackupTarget,
  type BackupTargetKind,
  type CreateBackupTargetInput,
  type UpdateBackupTargetInput,
} from "@menote/shared";
import { Button, Field } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { Modal } from "../../../app/ui/Modal";
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import {
  KIND_ENDPOINT_PLACEHOLDER,
  KIND_LABEL,
  POLICY_LABEL,
  SCHEDULE_LABEL,
  buildTargetPayload,
  emptyTargetForm,
  formFromTarget,
  policyRisk,
  secretFieldLabel,
  showsS3Fields,
  type TargetForm,
} from "../model";

export interface BackupTargetDialogProps {
  open: boolean;
  /** `null` = 新建 */
  target: BackupTarget | null;
  onClose: () => void;
  /** 保存成功：让外层刷新列表 */
  onSaved: () => void;
  create: (input: CreateBackupTargetInput) => Promise<BackupTarget>;
  update: (id: string, input: UpdateBackupTargetInput) => Promise<BackupTarget>;
}

export function BackupTargetDialog({ open, target, onClose, onSaved, create, update }: BackupTargetDialogProps) {
  const isNew = target === null;
  /*
    状态**随挂载初始化**，不用 effect 重置：上一个填了一半的表单不该留在下一个目标上。
    「重置」靠调用方给 `key` 重挂载本组件来做（`McpSettingsPage` 的 `CreateTokenDialog` 同款）。
  */
  const [form, setForm] = useState<TargetForm>(() => (target === null ? emptyTargetForm() : formFromTarget(target)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function patch(next: Partial<TargetForm>): void {
    setForm((current) => ({ ...current, ...next }));
  }

  async function submit(): Promise<void> {
    const built = buildTargetPayload(form, isNew);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (target === null) await create(built.value as CreateBackupTargetInput);
      else await update(target.id, built.value as UpdateBackupTargetInput);
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  const risk = policyRisk(form.delete_policy);
  const isS3 = showsS3Fields(form.kind);

  return (
    <Modal
      open={open}
      title={isNew ? "添加备份目标" : `编辑「${target?.label ?? ""}」`}
      onClose={onClose}
      // 填了一半时点外面就丢了，所以不让遮罩随手关掉（DESIGN.md §6.4 的例外）
      dismissable={false}
      footer={
        <>
          <Button variant="secondary" size="sm" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>
            {isNew ? "添加" : "保存"}
          </Button>
        </>
      }
    >
      {error !== null ? (
        <div role="alert" className="hint-line">
          <span>{error}</span>
        </div>
      ) : null}

      <div className="field">
        <span>
          类型
          {/* 改类型要重建（桶名 / 签名算法全变），所以编辑态直接不给 */}
          {isNew ? null : <InfoHint label="为什么不能改类型">类型变了要重新填桶名和密钥，删掉重建更快。</InfoHint>}
        </span>
        <SegmentedControl
          ariaLabel="备份目标类型"
          value={form.kind}
          options={BackupTargetKinds.map((kind) => ({
            value: kind,
            label: KIND_LABEL[kind],
            // 置灰必须说明为何（DESIGN.md §6.1）
            disabled: !isNew,
            title: isNew ? undefined : "类型不可改：要换类型请删掉重建",
          }))}
          onChange={(value) => patch({ kind: value as BackupTargetKind })}
        />
      </div>

      <Field
        label="名称"
        value={form.label}
        maxLength={64}
        placeholder="如：家里的 NAS"
        onChange={(event) => patch({ label: event.target.value })}
      />

      <Field
        label="地址"
        type="url"
        value={form.endpoint}
        placeholder={KIND_ENDPOINT_PLACEHOLDER[form.kind]}
        onChange={(event) => patch({ endpoint: event.target.value })}
      />

      {isS3 ? (
        <Field
          label="桶名"
          value={form.bucket}
          placeholder="menote-backup"
          onChange={(event) => patch({ bucket: event.target.value })}
        />
      ) : null}

      {isS3 ? (
        <Field
          label="区域"
          value={form.region}
          placeholder="us-east-1"
          onChange={(event) => patch({ region: event.target.value })}
        />
      ) : null}

      <Field
        label={form.kind === "s3" ? "Access Key ID" : "用户名"}
        value={form.username}
        autoComplete="off"
        onChange={(event) => patch({ username: event.target.value })}
      />

      {/*
        凭据：新建必填、编辑留空即不改。label 里把这件事说出来，
        否则"清空输入框"和"不填"在界面上长得一模一样。
      */}
      <Field
        label={secretFieldLabel(!isNew, form.kind)}
        type="password"
        value={form.secret}
        autoComplete="off"
        onChange={(event) => patch({ secret: event.target.value })}
      />
      <p className="hint-line">
        密钥提交一次就再也不显示了，之后这里只会显示"已配置"。
        {isNew ? "填错了就删掉这个目标重建。" : "要换密钥才填，留空表示不改。"}
      </p>

      <div className="field">
        <span>远端删除</span>
        <SegmentedControl
          ariaLabel="远端删除策略"
          value={form.delete_policy}
          options={(["append_only", "sync"] as const).map((value) => ({
            value,
            label: POLICY_LABEL[value as BackupDeletePolicy],
          }))}
          onChange={(value) => patch({ delete_policy: value as BackupDeletePolicy })}
        />
      </div>

      {/* 破坏性后果平铺可见（DESIGN.md §5.4-2），不藏进 InfoHint */}
      {risk !== null ? <p className="hint-line">{risk}</p> : null}

      <div className="field">
        <span>频率</span>
        <SegmentedControl
          ariaLabel="备份频率"
          value={form.schedule}
          options={BackupSchedules.map((schedule) => ({
            value: schedule,
            label: SCHEDULE_LABEL[schedule as BackupSchedule],
          }))}
          onChange={(value) => patch({ schedule: value as BackupSchedule })}
        />
      </div>
    </Modal>
  );
}
