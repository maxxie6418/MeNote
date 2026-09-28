/**
 * 一行「名称 + 说明 + 密码输入」：版式与设置页其它分类一致
 * （`.setrow` + `.setrow__label` + `.field__input` + `.field__error`）。
 *
 * 抽出来是因为启用表与「隐私密码」卡都要用，且两处已拆到不同文件。
 */
export interface PasswordRowProps {
  name: string;
  desc?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error?: string | null;
}

export function PasswordRow({
  name,
  desc,
  value,
  onChange,
  autoComplete,
  error,
}: PasswordRowProps) {
  return (
    <div className="setrow">
      <div className="setrow__label">
        <span className="setrow__name">{name}</span>
        {desc ? <span className="setrow__desc">{desc}</span> : null}
        {error ? (
          <span className="field__error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <input
        type="password"
        className="field__input"
        aria-label={name}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
