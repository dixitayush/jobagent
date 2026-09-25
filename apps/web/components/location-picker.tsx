"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Location } from "@jobagent/shared";
import { useLocations } from "@/lib/queries";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Label, Select } from "./ui/input";
import { Skeleton } from "./ui/skeleton";

/** Cascading Country → State → City dropdowns with multi-select (PRD §11). */
export function LocationPicker({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const { data: locations, isLoading } = useLocations();
  const [country, setCountry] = useState<string>("");
  const [state, setState] = useState<string>("");
  const [city, setCity] = useState<string>("");

  const byId = useMemo(() => new Map((locations ?? []).map((l) => [l.id, l])), [locations]);
  const children = (parentId: number | null, type: Location["type"]) => (locations ?? []).filter((l) => l.type === type && l.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  const countries = children(null, "COUNTRY");
  const states = country ? children(Number(country), "STATE") : [];
  const cities = state ? children(Number(state), "CITY") : [];
  const remotes = (locations ?? []).filter((l) => l.type === "REMOTE");

  const add = (id: number) => {
    if (!value.includes(id)) onChange([...value, id]);
  };
  const selectedId = city ? Number(city) : state ? Number(state) : country ? Number(country) : null;
  const describe = (l: Location) => {
    const parent = l.parentId ? byId.get(l.parentId) : undefined;
    if (l.type === "COUNTRY") return `${l.name} (anywhere)`;
    if (l.type === "STATE") return `${l.name}, ${parent?.name ?? ""} (all cities)`;
    if (l.type === "CITY") return `${l.name}, ${parent?.name ?? ""}`;
    return l.name;
  };

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="loc-country">Country</Label>
          <Select id="loc-country" value={country} onChange={(e) => (setCountry(e.target.value), setState(""), setCity(""))}>
            <option value="">Select country</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc-state">State / Province</Label>
          <Select id="loc-state" value={state} disabled={!country} onChange={(e) => (setState(e.target.value), setCity(""))}>
            <option value="">Any state</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc-city">City</Label>
          <Select id="loc-city" value={city} disabled={!state} onChange={(e) => setCity(e.target.value)}>
            <option value="">Any city</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="secondary" disabled={!selectedId} onClick={() => selectedId && (add(selectedId), setCity(""))}>
          Add
        </Button>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Remote</legend>
        <div className="flex flex-wrap gap-2">
          {remotes.map((r) => {
            const on = value.includes(r.id);
            return (
              <Button key={r.id} type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => (on ? onChange(value.filter((v) => v !== r.id)) : add(r.id))}>
                {r.name}
              </Button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <p className="mb-2 text-sm font-medium" id="selected-locations">
          Preferred locations {value.length > 0 && <span className="text-muted-foreground">({value.length})</span>}
        </p>
        {value.length === 0 ? (
          <p className="text-sm text-muted-foreground">No locations selected — jobs from every location will be considered.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-labelledby="selected-locations">
            {value.map((id) => {
              const l = byId.get(id);
              return (
                <li key={id}>
                  <Badge className="gap-1.5 py-1 pl-3 pr-1.5 text-sm">
                    ✓ {l ? describe(l) : `#${id}`}
                    <button type="button" onClick={() => onChange(value.filter((v) => v !== id))} className="rounded-full p-0.5 hover:bg-accent" aria-label={`Remove ${l?.name ?? id}`}>
                      <X className="size-3.5" />
                    </button>
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
