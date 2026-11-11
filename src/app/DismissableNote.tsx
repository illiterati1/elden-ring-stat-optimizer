import { memo } from "react";
import { Alert, type SxProps, type Theme } from "@mui/material";
import { colors } from "./theme.ts";
import type { AppState, UpdateAppState } from "./useAppState.ts";

interface Props {
  /** Saved in closedAlerts once closed, until "Show all alerts" brings it back */
  id: string;
  closedAlerts: AppState["closedAlerts"];
  onChange: UpdateAppState;
  sx?: SxProps<Theme>;
  children: React.ReactNode;
}

/** A panel's explanatory note, as secondary text with a close button */
function DismissableNote({ id, closedAlerts, onChange, sx, children }: Props) {
  if (closedAlerts.includes(id)) return null;
  return (
    <Alert
      icon={false}
      onClose={() => onChange({ closedAlerts: [...closedAlerts, id] })}
      sx={[
        {
          py: 0.75,
          pl: 1.5,
          pr: 1,
          // A shade lighter than the panel, like tooltips
          bgcolor: colors.surfaceRaised,
          color: "text.secondary",
          typography: "body2",
          // (Alert's message scrolls its overflow, which shows a scrollbar beside the close button)
          "& .MuiAlert-message": { py: 0, overflow: "visible" },
          "& .MuiAlert-action": { pt: 0, mr: 0, alignItems: "flex-start" },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Alert>
  );
}

export default memo(DismissableNote);
