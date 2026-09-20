export function dateString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function heatLevel(n: number) {
  return n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 9 ? 3 : 4;
}
export function calendarCells(today: string, year: string) {
  let start: Date, end: Date;
  if (year === "recent") {
    end = new Date(today + "T12:00:00");
    start = new Date(end);
    start.setDate(start.getDate() - 363);
    start.setDate(start.getDate() - start.getDay());
  } else {
    start = new Date(Number(year), 0, 1, 12);
    end = new Date(Number(year), 11, 31, 12);
    start.setDate(start.getDate() - start.getDay());
  }
  const result = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = dateString(d);
    result.push({
      date,
      month: d.getMonth(),
      first: d.getDate() <= 7 && d.getDay() === 0,
      disabled:
        date > today || (year !== "recent" && d.getFullYear() !== Number(year)),
    });
  }
  while (result.length % 7)
    result.push({ date: "", month: 0, first: false, disabled: true });
  return result;
}
