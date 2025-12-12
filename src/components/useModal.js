// src/components/useModal.js
import { useCallback, useState } from "react";

export function useModal() {
  const [state, setState] = useState({
    open: false,
    title: "",
    tone: "info",
    content: null,
    confirmText: "OK",
    cancelText: "Cancel",
    showCancel: false,
    onConfirm: null,
    onCancel: null,
  });

  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  const show = useCallback((opts) => {
    setState({
      open: true,
      title: opts.title || "",
      tone: opts.tone || "info",
      content: opts.content || null,
      confirmText: opts.confirmText || "OK",
      cancelText: opts.cancelText || "Cancel",
      showCancel: Boolean(opts.showCancel),
      onConfirm: opts.onConfirm || null,
      onCancel: opts.onCancel || null,
    });
  }, []);

  return { modal: state, show, close };
}
