import { useEffect, useState } from "react";
import type { Weapon } from "../calculator/weapon.ts";
import { decodeRegulationData } from "../regulationData.ts";

export default function useWeapons() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [weapons, setWeapons] = useState<Weapon[]>([]);

  useEffect(() => {
    fetch("/regulation-vanilla-v1.17.js")
      .then((res) => res.json())
      .then((data) => {
        setWeapons(decodeRegulationData(data));
        setLoading(false);
      })
      .catch(setError);
  }, []);

  return { weapons, loading, error };
}
