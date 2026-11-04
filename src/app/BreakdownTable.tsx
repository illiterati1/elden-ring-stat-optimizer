import { memo } from "react";
import { Box, Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import { allAttributes } from "../calculator/calculator.ts";
import type { BreakdownRow } from "../optimizer/optimizer.ts";
import { getStatLabel } from "../optimizer/startingClasses.ts";
import { damageTypeIcons, damageTypeLabels } from "./uiUtils.ts";

interface Props {
  rows: BreakdownRow[];

  /** What one point of the objective is called: "damage" or "scaling" */
  pointLabel: string;
}

function format(value: number) {
  return Math.floor(value + 1e-9).toString();
}

const cellSx = { color: "inherit", px: 1, py: 0.25, borderBottomColor: "divider" };

/**
 * Table showing how much each attribute adds to each damage type
 */
function BreakdownTable({ rows: allRows, pointLabel }: Props) {
  // Spell scaling isn't really a damage type, so just show the school that's used (the best one)
  const spellScaling = pointLabel === "scaling";
  const rows = spellScaling
    ? [allRows.reduce((best, row) => (row.total > best.total ? row : best))]
    : allRows;

  const activeAttributes = allAttributes.filter((attribute) =>
    rows.some((row) => row.attributes[attribute]),
  );
  const showDamage = rows.some((row) => row.damage != null);
  const showBuff = rows.some((row) => row.buff);

  const sum = (getValue: (row: BreakdownRow) => number | undefined) =>
    rows.reduce((total, row) => total + (getValue(row) ?? 0), 0);

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          {!spellScaling && <TableCell sx={cellSx} />}
          <TableCell sx={cellSx} align="right">
            Base
          </TableCell>
          {activeAttributes.map((attribute) => (
            <TableCell key={attribute} sx={cellSx} align="right">
              {getStatLabel(attribute).slice(0, 3)}
            </TableCell>
          ))}
          {showBuff && (
            <TableCell
              sx={cellSx}
              align="right"
              title="Weapon buffs' attack power, as the game's menu shows it (some attacks get only part of it)"
            >
              Buff
            </TableCell>
          )}
          <TableCell sx={cellSx} align="right">
            {spellScaling ? "Scaling" : "AR"}
          </TableCell>
          {showDamage && (
            <TableCell sx={cellSx} align="right">
              Damage
            </TableCell>
          )}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.damageType}
            sx={
              row.penalized
                ? { color: "error.light" }
                : row.maximized
                ? { color: "primary.main" }
                : undefined
            }
            title={row.penalized ? "Requirements not met: base reduced by 40%" : undefined}
          >
            {!spellScaling && (
              <TableCell sx={cellSx}>
                <Box display="flex" alignItems="center" gap={0.5}>
                  <img src={damageTypeIcons.get(row.damageType)} alt="" width={16} height={16} />
                  {damageTypeLabels.get(row.damageType)}
                </Box>
              </TableCell>
            )}
            <TableCell sx={cellSx} align="right">
              {row.flatOnly ? "–" : format(row.base)}
            </TableCell>
            {activeAttributes.map((attribute) => {
              const bonus = row.attributes[attribute];
              return (
                <TableCell key={attribute} sx={cellSx} align="right">
                  {bonus ? `+${format(bonus)}` : "–"}
                </TableCell>
              );
            })}
            {showBuff && (
              <TableCell sx={cellSx} align="right">
                {row.buff ? `+${format(row.buff)}` : "–"}
              </TableCell>
            )}
            <TableCell sx={cellSx} align="right">
              {row.flatOnly && !row.buff ? "–" : format(row.total)}
            </TableCell>
            {showDamage && (
              <TableCell sx={cellSx} align="right">
                {row.damage != null ? format(row.damage) : "–"}
              </TableCell>
            )}
          </TableRow>
        ))}
        {rows.length > 1 && (
          <TableRow>
            <TableCell sx={cellSx}>Total</TableCell>
            <TableCell sx={cellSx} align="right">
              {format(sum((row) => row.base))}
            </TableCell>
            {activeAttributes.map((attribute) => (
              <TableCell key={attribute} sx={cellSx} align="right">
                +{format(sum((row) => row.attributes[attribute]))}
              </TableCell>
            ))}
            {showBuff && (
              <TableCell sx={cellSx} align="right">
                +{format(sum((row) => row.buff))}
              </TableCell>
            )}
            <TableCell sx={cellSx} align="right">
              {format(sum((row) => row.total))}
            </TableCell>
            {showDamage && (
              <TableCell sx={cellSx} align="right">
                {format(sum((row) => row.damage))}
              </TableCell>
            )}
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export default memo(BreakdownTable);
