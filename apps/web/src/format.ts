// Times are shown in the viewer's own time zone, day first, with the zone named, so a reader abroad
// knows which clock it is: "27 Oct 2026, 21:23 GMT+3". The zone argument is for tests.
export function formatTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    ...(timeZone && { timeZone }),
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}
