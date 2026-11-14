import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Box,
  Drawer,
  IconButton,
  SvgIcon,
  Tooltip,
  Typography,
  useMediaQuery,
  type SxProps,
  type Theme,
} from "@mui/material";
import { colors } from "./theme.ts";

/**
 * True on devices whose main input can't hover (phones, tablets), where tooltips don't work well
 */
export function useTouch() {
  // Read on the first render, so the touch layout doesn't flash in after the desktop one
  return useMediaQuery("(hover: none)", { noSsr: true });
}

/**
 * Whether something like a drawer is open, closed by the back button as if it were a page: opening
 * it adds a history entry, and closing it in any way goes back past that entry
 */
export function useBackClosable() {
  const [open, setOpen] = useState(false);
  // Whether the history entry is still there, so closing twice (e.g. a quick double tap) doesn't
  // go back past it
  const pushed = useRef(false);
  useEffect(() => {
    if (!open) return;
    const onPop = () => {
      pushed.current = false;
      setOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);
  return {
    open,
    show: () => {
      if (!pushed.current) {
        window.history.pushState(null, "");
        pushed.current = true;
      }
      setOpen(true);
    },
    // Closed when going back (the popstate)
    hide: () => {
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      } else {
        setOpen(false);
      }
    },
  };
}

export function CloseIcon() {
  return (
    <SvgIcon>
      <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </SvgIcon>
  );
}

/** A dotted underline marking values with more details */
export const tooltipCueSx = {
  textDecoration: "underline dotted",
  textDecorationColor: colors.textSecondary,
  textUnderlineOffset: "3px",
  cursor: "help",
};

/** The background of tooltips and the details drawer, for anything drawn over their content */
export const detailsBackground = colors.surfaceRaised;

interface Props {
  /** The drawer's heading, e.g. the weapon's name and which details these are */
  title: string;
  /** The details, or nothing if there aren't any */
  content: ReactNode;
  /** The value the details are for */
  children: ReactNode;
  triggerSx?: SxProps<Theme>;
}

/**
 * A value with details too big for a regular tooltip, e.g. a table: shown in a tooltip on hover,
 * or on touch devices in a drawer from the bottom of the screen when the value is tapped, where it
 * can be read at length and scrolled
 */
function Details({ title, content, children, triggerSx }: Props) {
  const touch = useTouch();
  const [open, setOpen] = useState(false);
  const sx = [tooltipCueSx, ...(Array.isArray(triggerSx) ? triggerSx : [triggerSx])];

  if (!touch) {
    return (
      <Tooltip componentsProps={{ tooltip: { sx: { maxWidth: "none", p: 1 } } }} title={content}>
        <Box component="span" sx={sx}>
          {children}
        </Box>
      </Tooltip>
    );
  }
  if (!content) {
    return (
      <Box component="span" sx={triggerSx}>
        {children}
      </Box>
    );
  }
  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen(true)}
        sx={[
          {
            font: "inherit",
            color: "inherit",
            textAlign: "inherit",
            background: "none",
            border: "none",
            p: 0,
          },
          ...sx,
        ]}
      >
        {children}
      </Box>
      <Drawer
        anchor="bottom"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{
          sx: {
            maxHeight: "80vh",
            backgroundColor: detailsBackground,
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
          },
        }}
      >
        <Box display="flex" alignItems="center" gap={1} pl={2} pr={1} py={0.5}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {title}
          </Typography>
          <IconButton aria-label="Close" onClick={() => setOpen(false)}>
            <CloseIcon />
          </IconButton>
        </Box>
        {/* Wide tables scroll sideways here rather than running off the screen. No padding at
            the sides, since sticky columns stick inside it and content would show through it */}
        <Box sx={{ overflow: "auto", pb: 2 }}>{content}</Box>
      </Drawer>
    </>
  );
}

export default Details;
