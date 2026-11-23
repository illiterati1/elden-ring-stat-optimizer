import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import { readSaveFile, SaveFileError, type SaveCharacter } from "./saveFile.ts";
import {
  getGearUpdate,
  getImportedGear,
  getSaveGrip,
  type ImportedGear,
  type SaveImportData,
  type SaveItems,
} from "./saveImport.ts";
import { getNgPlusLabel, maxNgPlus } from "./useEnemies.ts";
import { loadRememberedSave, storeRememberedSave, type RememberedSave } from "./rememberedSave.ts";
import Section from "./Section.tsx";
import { desktopOs, type DesktopOs } from "./mobile.ts";
import type { AppState, UpdateAppState } from "./useAppState.ts";

/** Chrome and Edge's File System Access API, which TypeScript's DOM types don't have yet */
declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      /** Opens the picker in the folder last picked from with the same ID */
      id?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle[]>;
  }
  interface FileSystemHandle {
    queryPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
    requestPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
  }
}

/** The save under Proton, in Steam's default library (another library has its own steamapps folder) */
const protonSave =
  "~/.local/share/Steam/steamapps/compatdata/1245620/pfx/drive_c/users/steamuser/AppData/Roaming/EldenRing/<number>/ER0000.sl2";
/** The save under CrossOver (Elden Ring has no Mac version) */
const crossOverSave =
  "~/Library/Application Support/CrossOver/Bottles/<bottle>/drive_c/users/crossover/AppData/Roaming/EldenRing/<number>/ER0000.sl2";

/** Where the save file is on each OS */
const saveLocation: Record<DesktopOs, ReactNode> = {
  windows: <code>%APPDATA%\EldenRing\&lt;number&gt;\ER0000.sl2</code>,
  linux: (
    <>
      <code>{protonSave}</code> (in the file dialog, Ctrl+L types a path and Ctrl+H shows hidden
      folders)
    </>
  ),
  mac: (
    <>
      with CrossOver, <code>{crossOverSave}</code> (in the file dialog, Cmd+Shift+G types a path)
    </>
  ),
};

/**
 * How to get live updates on each OS: Chrome's File System Access blocklist covers where the save is
 * (AppData on Windows; ~/.local/share, /run/media, and dot folders in home on Linux; ~/Library on a Mac),
 * and resolves symlinks and junctions, but a hard link elsewhere is a different path to the same file
 */
const liveUpdatesHint: Record<DesktopOs, ReactNode> = {
  windows: (
    <>
      For live updates, the browser can't open the save in AppData, but can open a hard link to it
      elsewhere, made once in a Command Prompt, e.g.{" "}
      <code>
        mklink /H "%USERPROFILE%\Documents\ER0000.sl2"
        "%APPDATA%\EldenRing\&lt;number&gt;\ER0000.sl2"
      </code>
    </>
  ),
  linux: (
    <>
      For live updates, the browser can't open the save in ~/.local/share, but can open a hard link
      to it elsewhere on the same drive, made once in a terminal, e.g.{" "}
      <code>ln {protonSave} ~/Documents/ER0000.sl2</code>. A save on an SD card (under /run/media)
      can't have live updates.
    </>
  ),
  mac: (
    <>
      For live updates, the browser can't open the save in ~/Library, but can open a hard link to it
      elsewhere, made once in Terminal, e.g.{" "}
      <code>ln "{crossOverSave.replace("~", "$HOME")}" ~/Documents/ER0000.sl2</code>
    </>
  ),
};

/** How often a live save file is checked for changes */
const pollInterval = 2000;

let saveItemsPromise: Promise<SaveItems> | undefined;
function loadSaveItems() {
  saveItemsPromise ??= fetch("/saveItems.json").then((res) => res.json());
  return saveItemsPromise;
}

interface Props {
  /** Undefined until the weapons, buffs, and Ashes of War have loaded */
  data: Omit<SaveImportData, "items"> | undefined;
  selectedBuffs: AppState["buffs"];
  onChange: UpdateAppState;
}

interface OpenSave {
  fileName: string;
  savedAt: Date;
  characters: SaveCharacter[];
  /** Set when opened with the File System Access API, which can read it again when it changes */
  handle?: FileSystemFileHandle;
  lastModified: number;
}

/**
 * Fills in the stats and gear from a character in an Elden Ring save file, and with live updates,
 * again whenever the game saves. Live updates only change what changed in the save, and keep the
 * grip. A save opened with live updates is remembered, and reopened on later visits (right away if
 * the browser still allows reading it, otherwise with a click).
 */
function SaveImport({ data, selectedBuffs, onChange }: Props) {
  const [save, setSave] = useState<OpenSave | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [liveUpdates, setLiveUpdates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SaveItems | null>(null);
  /** The save remembered from an earlier visit, until it's reopened or another one is opened */
  const [remembered, setRemembered] = useState<RememberedSave | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** The gear last imported, so live updates only change what the save changed */
  const lastGear = useRef<ImportedGear | null>(null);
  // The latest of these for reads that finish later
  const latest = useRef({ data, items, selectedBuffs, onChange });
  latest.current = { data, items, selectedBuffs, onChange };
  /** The open save's handle and live updates setting, remembered with each import */
  const handleRef = useRef<FileSystemFileHandle | undefined>();
  const liveUpdatesRef = useRef(liveUpdates);
  liveUpdatesRef.current = liveUpdates;

  const character = save?.characters.find((c) => c.slot === slot);

  /** Imports the character's gear: everything, or only what changed since the last import */
  const importGear = (
    importedCharacter: SaveCharacter,
    everything: boolean,
    loadedItems = latest.current.items,
  ) => {
    const { data: current, selectedBuffs: buffs, onChange: change } = latest.current;
    if (!current || !loadedItems) return;
    const gear = getImportedGear(importedCharacter, { ...current, items: loadedItems });
    const update = getGearUpdate(gear, everything ? null : lastGear.current, buffs);
    if (everything) update.grips = [getSaveGrip(importedCharacter)];
    lastGear.current = gear;
    if (Object.keys(update).length) change(update);
    if (handleRef.current) {
      storeRememberedSave({
        handle: handleRef.current,
        slot: importedCharacter.slot,
        gear,
        liveUpdates: liveUpdatesRef.current,
      });
    }
  };

  /**
   * Reads a newly opened save, and imports the character in the same slot, or the first one
   * @param previous a remembered save being reopened, whose character's gear only changes where the
   * save changed since
   */
  const open = async (file: File, handle?: FileSystemFileHandle, previous?: RememberedSave) => {
    setError(null);
    setRemembered(null);
    handleRef.current = handle;
    if (!handle) storeRememberedSave(null);
    try {
      const [buffer, loadedItems] = await Promise.all([file.arrayBuffer(), loadSaveItems()]);
      const characters = readSaveFile(buffer);
      if (!characters.length) throw new SaveFileError("The save file has no characters");
      setItems(loadedItems);
      setSave({
        fileName: file.name,
        savedAt: new Date(file.lastModified),
        characters,
        handle,
        lastModified: file.lastModified,
      });
      const previousCharacter = previous && characters.find((c) => c.slot === previous.slot);
      if (previousCharacter && previous.gear) lastGear.current = previous.gear;
      const picked = previousCharacter ?? characters.find((c) => c.slot === slot) ?? characters[0];
      setSlot(picked.slot);
      importGear(picked, !(previousCharacter && previous.gear), loadedItems);
    } catch (e) {
      setError(e instanceof SaveFileError ? e.message : `Couldn't read the save file: ${e}`);
    }
  };

  const openLive = async () => {
    try {
      const [handle] = await window.showOpenFilePicker!({
        id: "eldenRingSave",
        types: [
          { description: "Elden Ring save", accept: { "application/octet-stream": [".sl2"] } },
        ],
      });
      await open(await handle.getFile(), handle);
    } catch (e) {
      // Closing the picker isn't an error
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(`Couldn't open the save file: ${e}`);
      }
    }
  };

  /** Reopens the remembered save, asking to read it again if the browser asks for that */
  const reopen = async (save: RememberedSave, ask: boolean) => {
    try {
      const permission = ask
        ? await save.handle.requestPermission?.({ mode: "read" })
        : await save.handle.queryPermission?.({ mode: "read" });
      if (permission !== "granted") {
        if (ask) setError("The browser wasn't allowed to read the save file");
        return;
      }
      setLiveUpdates(save.liveUpdates);
      liveUpdatesRef.current = save.liveUpdates;
      await open(await save.handle.getFile(), save.handle, save);
    } catch (e) {
      // e.g. the file was moved or deleted
      setRemembered(null);
      storeRememberedSave(null);
      setError(`Couldn't reopen ${save.handle.name}: ${e}`);
    }
  };

  // Once everything's loaded, reopen the save remembered from an earlier visit if the browser
  // still allows reading it, otherwise offer to
  const loaded = !!data;
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    loadRememberedSave().then((save) => {
      if (cancelled || !save) return;
      setRemembered(save);
      reopen(save, false);
    });
    return () => {
      cancelled = true;
    };
    // Only on load: reopen only reads refs and its arguments
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Live updates: read the file again when it changes, keeping the picked character
  const handle = save?.handle;
  const lastModified = save?.lastModified;
  useEffect(() => {
    if (!handle || !liveUpdates || slot == null) return;
    let cancelled = false;
    const check = async () => {
      try {
        const file = await handle.getFile();
        if (file.lastModified === lastModified) return;
        const characters = readSaveFile(await file.arrayBuffer());
        if (cancelled) return;
        setError(null);
        setSave(
          (prev) =>
            prev && {
              ...prev,
              characters,
              savedAt: new Date(file.lastModified),
              lastModified: file.lastModified,
            },
        );
        const updated = characters.find((c) => c.slot === slot);
        if (updated) importGear(updated, false);
      } catch (e) {
        // Caught mid-write: tried again next time
        if (!cancelled)
          setError(e instanceof SaveFileError ? e.message : `Couldn't read the save file: ${e}`);
      }
    };
    const timer = setInterval(check, pollInterval);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // importGear only reads refs and its arguments
  }, [handle, lastModified, liveUpdates, slot]);

  return (
    <Section id="saveFile" title="Save File">
      <Typography
        variant="body2"
        color="text.secondary"
        gutterBottom
        sx={{ overflowWrap: "anywhere" }}
      >
        Fill in a character's stats, weapons, talismans, and armor from your save:{" "}
        {saveLocation[desktopOs]}. It's only read here in your browser, never uploaded.
      </Typography>
      <Box display="flex" flexWrap="wrap" gap={1} mb={1}>
        <Button
          variant="outlined"
          size="small"
          disabled={!data}
          onClick={() => inputRef.current?.click()}
        >
          Open save file
        </Button>
        {window.showOpenFilePicker && (
          <Button variant="outlined" size="small" disabled={!data} onClick={openLive}>
            Open with live updates
          </Button>
        )}
        {remembered && !save && (
          <Button variant="contained" size="small" onClick={() => reopen(remembered, true)}>
            Reopen {remembered.handle.name}
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".sl2,.bak"
          hidden
          onChange={(evt) => {
            const file = evt.currentTarget.files?.[0];
            evt.currentTarget.value = "";
            if (file) open(file);
          }}
        />
      </Box>
      {window.showOpenFilePicker && !save?.handle && (
        <Typography
          variant="body2"
          color="text.secondary"
          gutterBottom
          sx={{ overflowWrap: "anywhere" }}
        >
          {liveUpdatesHint[desktopOs]}
        </Typography>
      )}
      {error && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {save && character && (
        <Box display="grid" gridTemplateColumns="1fr" gap={1}>
          <Typography variant="body2" color="text.secondary">
            {save.fileName}, saved {save.savedAt.toLocaleTimeString()}
            {save.handle ? "" : " (open it again to update)"}
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel id="saveCharacterLabel">Character</InputLabel>
            <Select
              labelId="saveCharacterLabel"
              label="Character"
              value={character.slot}
              onChange={(evt) => {
                const picked = save.characters.find((c) => c.slot === +evt.target.value);
                if (!picked) return;
                setSlot(picked.slot);
                importGear(picked, true);
              }}
            >
              {save.characters.map((c) => (
                <MenuItem key={c.slot} value={c.slot}>
                  {c.name} — Level {c.level}
                  {c.clearCount ? `, ${getNgPlusLabel(Math.min(c.clearCount, maxNgPlus))}` : ""}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {save.handle && (
            <FormControlLabel
              sx={{ mr: 0 }}
              label="Live updates"
              title="Update the stats and gear whenever the game saves (checked every few seconds)"
              control={
                <Checkbox
                  size="small"
                  checked={liveUpdates}
                  onChange={(evt) => {
                    const checked = evt.currentTarget.checked;
                    setLiveUpdates(checked);
                    liveUpdatesRef.current = checked;
                    if (handleRef.current && character) {
                      storeRememberedSave({
                        handle: handleRef.current,
                        slot: character.slot,
                        gear: lastGear.current,
                        liveUpdates: checked,
                      });
                    }
                  }}
                />
              }
            />
          )}
        </Box>
      )}
    </Section>
  );
}

export default memo(SaveImport);
