const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function shanghaiNow(date = new Date()) {
  const parts = Object.fromEntries(
    shanghaiFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const isoDate = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  return {
    date: isoDate,
    time,
    dateTime: `${isoDate}T${time}`,
    monthDay: `${parts.month}/${parts.day}`,
  };
}

export function addCalendarDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(result.getUTCDate()).padStart(2, '0')}`;
}

export function isoDateToMonthDay(isoDate: string) {
  const [, month, day] = isoDate.split('-');
  return `${month}/${day}`;
}

export function shanghaiDateTimeToIso(value: string) {
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return new Date(`${withSeconds}+08:00`).toISOString();
}
