"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { allProjects as baseProjects } from "@/lib/mock/data";
import type { Project } from "@/lib/mock/types";

const STORAGE_KEY = "iota.customProjects.v1";
const HIDDEN_KEY = "iota.hiddenProjects.v1";

interface ProjectsContextValue {
  /** All projects visible in the UI — the seeded mock projects plus any
   *  the manager has initialized, minus any that were deleted. */
  projects: Project[];
  /** Append a brand-new project. It appears in the dashboard list
   *  immediately and persists in localStorage on this browser. */
  addProject: (project: Project) => void;
  /** Delete a project. Custom projects are dropped outright; seeded demo
   *  projects are hidden (the id is remembered so they stay gone). Both
   *  persist; clearing localStorage brings the seeds back. */
  removeProject: (id: string) => void;
  /** Look up a project by id. Returns undefined if unknown or deleted. */
  getProject: (id: string) => Project | undefined;
  /** Whether we've hydrated from localStorage yet. Lets consumers avoid
   *  rendering empty state for one frame while hydration runs. */
  hydrated: boolean;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

/** Wrapping the app. Reads custom + hidden projects from localStorage on
 *  mount, writes back on every change. Persists across refreshes and
 *  tab-close on the same browser — enough for a gated single-viewer demo,
 *  no backend. */
export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [customProjects, setCustomProjects] = useState<Project[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Project[];
        if (Array.isArray(parsed)) setCustomProjects(parsed);
      }
    } catch {
      // ignore — corrupted entry, treat as empty
    }
    try {
      const rawHidden = localStorage.getItem(HIDDEN_KEY);
      if (rawHidden) {
        const parsed = JSON.parse(rawHidden) as string[];
        if (Array.isArray(parsed)) setHiddenIds(parsed);
      }
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  // Persist whenever either list changes (only after hydration so we don't
  // overwrite stored data on first mount).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customProjects));
    } catch {
      // ignore quota errors
    }
  }, [customProjects, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenIds));
    } catch {
      // ignore
    }
  }, [hiddenIds, hydrated]);

  const addProject = useCallback((p: Project) => {
    setCustomProjects((prev) => [...prev, p]);
  }, []);

  const removeProject = useCallback((id: string) => {
    // Drop it from custom projects (if it's one)...
    setCustomProjects((prev) => prev.filter((p) => p.id !== id));
    // ...and remember it as hidden (covers seeded projects too).
    setHiddenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const projects = useMemo(
    () =>
      [...baseProjects, ...customProjects].filter(
        (p) => !hiddenIds.includes(p.id)
      ),
    [customProjects, hiddenIds]
  );

  const getProject = useCallback(
    (id: string) => projects.find((p) => p.id === id),
    [projects]
  );

  return (
    <ProjectsContext.Provider
      value={{ projects, addProject, removeProject, getProject, hydrated }}
    >
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) {
    throw new Error("useProjects must be used inside <ProjectsProvider>");
  }
  return ctx;
}
