import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  TextField,
  Typography,
} from "@mui/material";
import type { AppState } from "./useAppState.ts";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The reporter's settings, sent along if they choose to, to reproduce the issue with */
  appState: AppState;
}

const repoUrl = "https://github.com/illiterati1/elden-ring-stat-optimizer";
const maxTitleLength = 120;
const maxDescriptionLength = 5000;

/**
 * The Turnstile site key, set at build time. Without one (e.g. in development) this is Cloudflare's
 * test key that always passes, whose tokens a real secret key rejects.
 */
const turnstileSiteKey =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || "1x00000000000000000000AA";

interface Turnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let turnstilePromise: Promise<Turnstile> | undefined;

/** Loads Cloudflare Turnstile's script the first time the form opens */
function loadTurnstile() {
  turnstilePromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile didn't load"));
    script.onerror = () => {
      turnstilePromise = undefined;
      reject(new Error("Couldn't load the verification widget"));
    };
    document.head.appendChild(script);
  });
  return turnstilePromise;
}

/**
 * A form that files a GitHub issue through the site's /api/report-issue function, as a bot account,
 * so reporters don't need a GitHub account
 */
export default function ReportIssueDialog({ open, onClose, appState }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [includeSettings, setIncludeSettings] = useState(true);
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  /** The new issue's URL once filed (null if the server didn't give one) */
  const [filedUrl, setFiledUrl] = useState<string | null>();
  const widgetIdRef = useRef<string>();

  // Shows the verification widget while the form is open (the container mounts with the dialog)
  const [widgetContainer, setWidgetContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || !widgetContainer || filedUrl !== undefined) return;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return;
        widgetIdRef.current = turnstile.render(widgetContainer, {
          sitekey: turnstileSiteKey,
          theme: "dark",
          callback: setToken,
          "expired-callback": () => setToken(undefined),
          "error-callback": () => setToken(undefined),
        });
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = undefined;
      setToken(undefined);
    };
  }, [open, widgetContainer, filedUrl]);

  function close() {
    onClose();
    // A filed report starts a new one next time; an unsent one stays as a draft
    if (filedUrl !== undefined) {
      setTitle("");
      setDescription("");
      setFiledUrl(undefined);
    }
    setError(undefined);
  }

  async function submit() {
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await fetch("/api/report-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          settings: includeSettings ? appState : undefined,
          turnstileToken: token,
          website,
        }),
      });
      const result = (await res.json().catch(() => ({}))) as {
        url?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(result.error ?? `Couldn't file the report (${res.status}).`);
      setFiledUrl(result.url ?? null);
    } catch (e) {
      setError((e as Error).message);
      // A token only works once
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
      setToken(undefined);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    title.trim().length > 0 &&
    title.length <= maxTitleLength &&
    description.trim().length > 0 &&
    description.length <= maxDescriptionLength &&
    !!token &&
    !submitting;

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>Report a bug or inaccuracy</DialogTitle>
      {filedUrl !== undefined ? (
        <>
          <DialogContent>
            <Typography>
              Thanks, your report was filed
              {filedUrl ? (
                <>
                  {" "}
                  as{" "}
                  <Link href={filedUrl} target="_blank" rel="noopener noreferrer">
                    an issue on GitHub
                  </Link>
                </>
              ) : null}
              .
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>Close</Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" mb={2}>
              Reports are posted publicly as{" "}
              <Link href={`${repoUrl}/issues`} target="_blank" rel="noopener noreferrer">
                GitHub issues
              </Link>
              , so don't include personal information. For an in-game test that disagrees with the
              calculator, say what you did and the numbers you saw.
            </Typography>
            <TextField
              label="Title"
              fullWidth
              size="small"
              margin="dense"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              inputProps={{ maxLength: maxTitleLength }}
            />
            <TextField
              label="What happened, and what did you expect?"
              fullWidth
              multiline
              minRows={5}
              margin="dense"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              inputProps={{ maxLength: maxDescriptionLength }}
              helperText={`${description.length} / ${maxDescriptionLength}`}
            />
            {/* Hidden from people; bots that fill in every field give themselves away */}
            <Box
              aria-hidden
              sx={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }}
            >
              <input
                tabIndex={-1}
                autoComplete="off"
                name="website"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </Box>
            <FormControlLabel
              label="Include my calculator settings, to reproduce the issue"
              control={
                <Checkbox
                  size="small"
                  checked={includeSettings}
                  onChange={(event) => setIncludeSettings(event.target.checked)}
                />
              }
            />
            <Box ref={setWidgetContainer} mt={1} minHeight={65} />
            {error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {error}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>Cancel</Button>
            <Button variant="contained" disabled={!canSubmit} onClick={submit}>
              {submitting ? "Sending…" : "Send report"}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
