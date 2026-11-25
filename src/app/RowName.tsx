import { labelSeparator } from "./weaponRequests.ts";

/**
 * A row's name, wrapping after the dot between its weapon and its attack rather than inside its
 * attack (e.g. not between "Powerstance" and "L1")
 */
export default function RowName({ name }: { name: string }) {
  const [weapon, ...attack] = name.split(labelSeparator);
  if (!attack.length) return name;
  return (
    <>
      {weapon}
      {" · "}
      <span style={{ whiteSpace: "nowrap" }}>{attack.join(labelSeparator)}</span>
    </>
  );
}
