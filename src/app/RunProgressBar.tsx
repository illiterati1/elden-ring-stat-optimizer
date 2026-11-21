import { memo, useSyncExternalStore } from "react";
import { Box, LinearProgress, Typography } from "@mui/material";
import type { ProgressStore } from "./useBuildResults.ts";

interface Props {
  /** The table's run */
  progress: ProgressStore;
  /** Anything is being worked out (the table's results or the pins') */
  pending: boolean;
}

/**
 * The bar shown while results are worked out, filling up with the table's requests answered, and
 * how many of them, e.g. "Calculating 3,400 / 12,000". It shows the table's progress on its own,
 * so the rest of the page doesn't render again whenever it changes.
 */
function RunProgressBar({ progress: store, pending }: Props) {
  const progress = useSyncExternalStore(store.subscribe, store.get);
  // Pinned rows aren't counted: they're worked out by a pool of their own, which starts and finishes
  // apart from the table's (pinning a row only reruns the pins), and there are usually only a few.
  // While only they're pending, the bar moves without a count.
  const shown = pending && progress && progress.done < progress.total ? progress : undefined;
  return (
    <Box sx={{ position: "relative" }}>
      <LinearProgress
        sx={{ visibility: pending ? "visible" : "hidden" }}
        {...(shown && {
          variant: "determinate",
          value: (shown.done / shown.total) * 100,
        })}
      />
      {shown && (
        <Typography
          variant="caption"
          color="text.secondary"
          role="status"
          // (in the gap above the bar, so it doesn't cover the table's header)
          sx={{
            position: "absolute",
            bottom: "100%",
            right: 0,
            lineHeight: 1.4,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {shown.phase === "ranking" ? "Ranking" : "Calculating"} {shown.done.toLocaleString()} /{" "}
          {shown.total.toLocaleString()}
        </Typography>
      )}
    </Box>
  );
}

export default memo(RunProgressBar);
