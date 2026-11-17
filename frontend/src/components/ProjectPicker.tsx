import { useEffect, useRef, useState } from "react";

import { listProjects } from "../api";
import { translate, type Language } from "../i18n";

type Props = {
  language: Language;
  onClose: () => void;
  onLoad: (projectId: string) => Promise<boolean>;
};

export function ProjectPicker({ language, onClose, onLoad }: Props) {
  const [projects, setProjects] = useState<string[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loadingProject, setLoadingProject] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    let active = true;
    void listProjects().then((items) => {
      if (active) setProjects(items);
    }).catch((err: Error) => {
      if (active) setError(err.message);
    });
    return () => {
      active = false;
      previousFocus?.focus();
    };
  }, []);

  async function loadSelected() {
    if (!selected || loadingProject) return;
    setLoadingProject(true);
    setError("");
    try {
      if (await onLoad(selected)) onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingProject(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !loadingProject) {
      event.preventDefault();
      onClose();
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']") ?? []);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && (index === -1 || index === focusable.length - 1)) {
      event.preventDefault();
      focusable[0].focus();
    }
  }

  return (
    <div className="dialog-backdrop">
      <div ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="project-picker-title" tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id="project-picker-title">{translate(language, "chooseProject")}</h2>
        {projects === null && !error ? <p role="status">{translate(language, "loading")}</p> : null}
        {projects?.length === 0 ? <p>{translate(language, "noProjects")}</p> : null}
        {error ? <p className="error-text" role="alert">{translate(language, "loadFailed")}: {error}</p> : null}
        {projects && projects.length > 0 ? (
          <div className="project-list" role="radiogroup" aria-label={translate(language, "chooseProject")}>
            {projects.map((id) => (
              <label className={selected === id ? "project-option selected" : "project-option"} key={id}>
                <input type="radio" name="project" value={id} checked={selected === id} onChange={() => setSelected(id)} />
                <span>{id}</span>
              </label>
            ))}
          </div>
        ) : null}
        <div className="dialog-actions">
          <button onClick={onClose} disabled={loadingProject}>{translate(language, "cancel")}</button>
          <button className="primary-action" onClick={() => void loadSelected()} disabled={!selected || loadingProject}>
            {loadingProject ? translate(language, "loading") : translate(language, "load")}
          </button>
        </div>
      </div>
    </div>
  );
}
