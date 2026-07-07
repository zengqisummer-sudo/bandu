import { useSettingsStore } from "../../stores/settingsStore";

export function RestoreAccess() {
  const { fsMissing, restoreFsAccess, chooseIdbMode } = useSettingsStore();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center shadow-sm">
        <div className="text-3xl">🔐</div>
        <h1 className="mt-3 text-lg font-semibold">恢复文件夹访问</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {fsMissing === "permission"
            ? "浏览器刷新后需要重新确认文件夹访问权限（浏览器安全要求，需点击授权）。"
            : "找不到之前的文件夹记录，请重新选择状态文件夹与产物文件夹。"}
        </p>
        <button
          onClick={() => void restoreFsAccess()}
          className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-paper hover:opacity-90"
        >
          {fsMissing === "permission" ? "恢复访问" : "重新选择文件夹"}
        </button>
        <button
          onClick={() => {
            if (confirm("切换到浏览器模式？文件夹里的数据不会丢失，但在浏览器模式下看不到。")) void chooseIdbMode();
          }}
          className="mt-2 w-full rounded-lg border border-line px-4 py-2.5 text-sm text-ink-soft hover:bg-accent-soft"
        >
          暂用浏览器模式
        </button>
      </div>
    </div>
  );
}
