document.addEventListener(
    'DOMContentLoaded',
    () => document.querySelectorAll('table').forEach(
        (table) => table.tHead?.querySelectorAll('th').forEach(
            (cell) => cell.replaceChildren(
                Object.assign(document.createElement('a'), {
                  href: '#',
                  textContent: cell.textContent,
                  onclick: () => {
                    toggleSort(table, cell.cellIndex);
                    return false;
                  },
                }),
                ),
            ),
        ),
);

function toggleSort(table: HTMLTableElement, column: number): void {
  Array.from(table.tBodies).forEach((body) => {
    const rows = Array.from(body.rows);
    const direction =
        rows.every(
            (row, i) => i === 0 || compare(rows[i - 1], row, column) <= 0) ?
        -1 :
        1;
    body.append(...rows.sort((a, b) => direction * compare(a, b, column)));
  });
}

function compare(
    a: HTMLTableRowElement, b: HTMLTableRowElement, column: number): number {
  const [x, y] =
      [a, b].map((row) => row.cells[column]?.textContent?.trim() ?? '');
  return isNaN(parseFloat(x)) || isNaN(parseFloat(y)) ||
          suffix(x) !== suffix(y) ?
      x.localeCompare(y) :
      parseFloat(x) - parseFloat(y);
}

function suffix(text: string): string {
  return text.replace(/^[+-]?\d*\.?\d+(e[+-]?\d+)?/i, '');
}
