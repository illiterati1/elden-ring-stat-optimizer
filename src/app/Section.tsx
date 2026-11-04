import { useState, type ReactNode } from "react";
import { Box, ButtonBase, Collapse, Paper, Typography } from "@mui/material";

interface Props {
  /** Identifies the panel, to remember whether it's collapsed */
  id: string;
  title: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}

const storageKey = (id: string) => `section:${id}:collapsed`;

/** @returns whether the panel was left collapsed, remembered in this browser */
function readCollapsed(id: string) {
  try {
    return localStorage.getItem(storageKey(id)) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(id: string, collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(storageKey(id), "1");
    else localStorage.removeItem(storageKey(id));
  } catch {
    // Storage may be unavailable (e.g. private browsing); it just won't be remembered
  }
}

/**
 * A titled panel grouping related settings, which collapses to its title when the title is clicked
 */
export default function Section({ id, title, action, children }: Props) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id));
  const toggle = () => {
    setCollapsed(!collapsed);
    writeCollapsed(id, !collapsed);
  };
  return (
    <Paper sx={{ p: 2 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <ButtonBase
          onClick={toggle}
          aria-expanded={!collapsed}
          sx={{ borderRadius: 1, justifyContent: "flex-start", textAlign: "left" }}
        >
          <Typography component="h2" variant="h6" sx={{ fontSize: "1.0625rem" }}>
            <Box component="span" aria-hidden sx={{ display: "inline-block", width: "1em" }}>
              {collapsed ? "▸" : "▾"}
            </Box>
            {title}
          </Typography>
        </ButtonBase>
        {!collapsed && action}
      </Box>
      {children && (
        <Collapse in={!collapsed}>
          <Box mt={2}>{children}</Box>
        </Collapse>
      )}
    </Paper>
  );
}
