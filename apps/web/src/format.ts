// Times are shown in Asia/Riyadh, day first, with the month spelled out so it can't be misread.
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Riyadh",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatter.format(date).replace(",", "");
}
