"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import type { Provider } from "@/lib/protocol";
import { clearProvider, closeDialog, saveProvider, useApp } from "@/lib/store";
import { Button, Sheet, cx } from "./ui";

export function ProvidersDialog({ open, focus }: { open: boolean; focus?: string }) {
  return (
    <Sheet
      open={open}
      onClose={closeDialog}
      title="API keys"
      subtitle="Bring your own key. It goes straight to your local agent, which stores it. This page never saves it, and the agent only sends back the last four characters."
      width={600}
    >
      <ProvidersBody focus={focus} />
    </Sheet>
  );
}

function ProvidersBody({ focus }: { focus?: string }) {
  const providers = useApp((s) => s.providers);
  const info = useApp((s) => s.info);
  const connection = useApp((s) => s.connection);
  const [openId, setOpenId] = useState<string | null>(
    () => focus ?? (providers.some((p) => p.configured) ? null : (providers[0]?.id ?? null)),
  );

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      {connection !== "online" ? (
        <div className="mx-5 mt-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-[13px] text-danger">
          The agent is offline, so keys can&apos;t be saved right now.
        </div>
      ) : (
        info && (
          <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-lg bg-hover/60 px-3 py-2.5 text-[12.5px] text-muted">
            <ShieldCheck size={15} className="mt-px shrink-0 text-ok" />
            <span>
              Stored by <span className="text-ink">{info.name}</span> at{" "}
              <span className="break-all font-mono text-[11.5px] text-ink/80">{info.keyStorage}</span>
              {info.mock && ". The mock agent never calls a provider with it."}
            </span>
          </div>
        )
      )}
      <div className="px-3 py-3">
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} />
        ))}
      </div>
    </div>
  );
}

function ProviderRow({ provider, open, onToggle }: { provider: Provider; open: boolean; onToggle: () => void }) {
  return (
    <div className={cx("rounded-lg transition-colors", open && "bg-raised shadow-[0_0_0_1px_var(--line)]")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left", !open && "hover:bg-hover/60")}
      >
        <span
          className={cx(
            "grid h-7 w-7 shrink-0 place-items-center rounded-md border font-mono text-[12px]",
            provider.configured ? "border-ok/40 text-ok" : "border-line-strong text-muted",
          )}
        >
          {provider.name.charAt(0)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] text-ink">{provider.name}</span>
          <span className="block font-mono text-[11px] text-faint">
            {provider.configured ? (
              <span className="text-ok">
                connected{provider.keyHint ? ` · ${provider.keyHint}` : ""} · {provider.models.length} model
                {provider.models.length === 1 ? "" : "s"}
              </span>
            ) : (
              "not connected"
            )}
          </span>
        </span>
        <ChevronRight size={15} className={cx("shrink-0 text-faint transition-transform", open && "rotate-90")} />
      </button>
      {open && <ProviderForm key={provider.id} provider={provider} />}
    </div>
  );
}

function ProviderForm({ provider }: { provider: Provider }) {
  const initialModels = provider.models.map((m) => m.id).join(", ");
  const [apiKey, setApiKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [models, setModels] = useState(initialModels);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const connection = useApp((s) => s.connection);

  const showBaseUrl = provider.needsBaseUrl || provider.baseUrl !== null;

  const submit = async () => {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await saveProvider(provider.id, {
        apiKey: apiKey.trim() || undefined,
        baseUrl: showBaseUrl && baseUrl.trim() !== (provider.baseUrl ?? "") ? baseUrl.trim() : undefined,
        models:
          models.trim() !== initialModels
            ? models
                .split(/[,\n]/)
                .map((m) => m.trim())
                .filter(Boolean)
            : undefined,
      });
      setApiKey("");
      setReveal(false);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    setPending(true);
    setError(null);
    try {
      await clearProvider(provider.id);
      setApiKey("");
      setSaved(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const keyPlaceholder = provider.keyHint
    ? `Stored (${provider.keyHint}). Paste a new key to replace it`
    : provider.keyOptional
      ? "Optional. Leave empty if the endpoint needs no key"
      : "Paste your API key";

  return (
    <form
      className="space-y-3 px-3 pb-3.5 pt-1"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="API key">
        <div className="flex items-center rounded-md border border-line bg-surface focus-within:border-line-strong">
          <input
            type={reveal ? "text" : "password"}
            name={`dopecode-${provider.id}-api-key`}
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setSaved(false);
            }}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            placeholder={keyPlaceholder}
            className="h-9 min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[12.5px] text-ink outline-none placeholder:font-sans placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "Hide key" : "Show key"}
            className="grid h-9 w-9 place-items-center text-faint hover:text-ink"
          >
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </Field>

      {showBaseUrl && (
        <Field label="Base URL" hint={provider.needsBaseUrl ? "Where your OpenAI-compatible server listens." : undefined}>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            spellCheck={false}
            placeholder="http://127.0.0.1:8000/v1"
            className="h-9 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
          />
        </Field>
      )}

      {provider.editableModels && (
        <Field label="Models" hint="Model IDs, separated by commas. They show up in the model picker.">
          <input
            value={models}
            onChange={(e) => setModels(e.target.value)}
            spellCheck={false}
            placeholder={provider.needsBaseUrl ? "e.g. qwen3-coder" : "e.g. vendor/model-name"}
            className="h-9 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
          />
        </Field>
      )}

      {error && <div className="text-[12.5px] text-danger">{error}</div>}

      <div className="flex items-center gap-2 pt-1">
        {saved && (
          <span className="flex items-center gap-1 font-mono text-[11.5px] text-ok">
            <Check size={12} /> saved to agent
          </span>
        )}
        <div className="flex-1" />
        {provider.configured && (
          <Button variant="danger" onClick={() => void remove()} disabled={pending || connection !== "online"}>
            Disconnect
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={pending || connection !== "online"}>
          {pending ? "Saving…" : provider.configured ? "Update" : "Connect"}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-faint">{hint}</span>}
    </label>
  );
}
