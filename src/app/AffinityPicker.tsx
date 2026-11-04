import { memo } from "react";
import { Box, Button, Checkbox, FormControlLabel } from "@mui/material";
import type { AppState, UpdateAppState } from "./useAppState.ts";
import { affinityOptions, type AffinityOption } from "./uiUtils.ts";

interface Props {
  affinityIds: AppState["affinityIds"];
  onChange: UpdateAppState;
}

/**
 * Set of checkboxes for selecting which affinities to compare, with a select all/none button
 */
function AffinityPicker({ affinityIds, onChange }: Props) {
  function renderAffinityCheckbox([affinityId, { text, icon }]: [number, AffinityOption]) {
    return (
      <FormControlLabel
        key={affinityId}
        label={
          <Box
            display="inline-grid"
            sx={{
              verticalAlign: "middle",
              gap: 1,
              gridAutoFlow: "column",
              alignItems: "center",
            }}
          >
            <img src={icon} width={24} height={24} alt="" />
            <span>{text}</span>
          </Box>
        }
        sx={{ display: "block", mr: 0, my: "-4px" }}
        control={
          <Checkbox
            size="small"
            checked={affinityIds.includes(affinityId)}
            name={text}
            onChange={(evt) =>
              onChange({
                affinityIds: evt.currentTarget.checked
                  ? [...affinityIds, affinityId]
                  : affinityIds.filter((value) => value !== affinityId),
              })
            }
          />
        }
      />
    );
  }

  const affinityList = [...affinityOptions];
  const half = Math.ceil(affinityList.length / 2);
  const allSelected = affinityList.every(([affinityId]) => affinityIds.includes(affinityId));

  return (
    <Box>
      <Button
        size="small"
        sx={{ ml: -0.5, mb: 0.5 }}
        onClick={() =>
          onChange({
            affinityIds: allSelected ? [] : affinityList.map(([affinityId]) => affinityId),
          })
        }
      >
        {allSelected ? "Select none" : "Select all"}
      </Button>
      <Box display="grid" sx={{ gridTemplateColumns: "1fr 1fr" }}>
        <Box>{affinityList.slice(0, half).map(renderAffinityCheckbox)}</Box>
        <Box>{affinityList.slice(half).map(renderAffinityCheckbox)}</Box>
      </Box>
    </Box>
  );
}

export default memo(AffinityPicker);
