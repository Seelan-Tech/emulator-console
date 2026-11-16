"use client";
import { createContext, useContext, useEffect, useState } from "react";

import { storage } from "@/lib/storage";

export type TargetInfo = { id: string; name: string; endpointUrl: string; region: string };
type Ctx = TargetInfo & {
  tid: string;
  defaultRegion: string;
  region: string;
  setRegion: (r: string) => void;
};

const TargetCtx = createContext<Ctx | null>(null);

export function TargetProvider({ target, children }: { target: TargetInfo; children: React.ReactNode }) {
  const key = `region:${target.id}`;
  const [region, setRegionState] = useState(target.region);

  useEffect(() => {
    const saved = storage.get(key);
    if (saved) setRegionState(saved);
  }, [key]);

  const setRegion = (r: string) => {
    setRegionState(r);
    storage.set(key, r);
  };

  return (
    <TargetCtx.Provider value={{ ...target, tid: target.id, defaultRegion: target.region, region, setRegion }}>
      {children}
    </TargetCtx.Provider>
  );
}

export function useTarget(): Ctx {
  const c = useContext(TargetCtx);
  if (!c) throw new Error("useTarget must be used inside the target shell");
  return c;
}
