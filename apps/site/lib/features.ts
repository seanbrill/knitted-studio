import data from "../content/features.json";

export type Status = "shipped" | "soon";
export interface Feature { id: string; group: string; status: Status; name: string; summary: string }
export interface Group { id: string; name: string; line: string }

export const GROUPS: Group[] = data.groups;
export const FEATURES = data.features as Feature[];

export function feature(id: string): Feature {
  const f = FEATURES.find((x) => x.id === id);
  if (!f) throw new Error(`content/features.json has no feature "${id}"`);
  return f;
}
