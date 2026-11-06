"use client";

// The trail at the top of a project, Projects > the project > the section > the folder,
// in one place. A section's page shows where it is in its own folders by handing those
// steps up here, so there is one trail, not two.

import { createContext, useContext } from "react";
import type { Crumb } from "@knitted/ui";

export type SetTrail = (steps: Crumb[] | null) => void;
export const TrailContext = createContext<SetTrail | null>(null);
export const useTrail = () => useContext(TrailContext);
