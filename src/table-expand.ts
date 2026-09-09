// For all tables that have a <th> with textContent including ` (expand)`, sets
// the width of the corresponding column to 100%.
document.addEventListener(
    'DOMContentLoaded',
    () => document.querySelectorAll('table').forEach(table => {
      const headers = Array.from(table.querySelectorAll('th'));
      const targetToken = ' (expand)';

      const expandIndex = headers.findIndex(
          th => th.textContent && th.textContent.includes(targetToken));

      if (expandIndex === -1) return;
      table.style.width = '100%';
      headers.forEach((th, index) => {
        if (index === expandIndex) {
          th.style.width = '100%';
          th.textContent = th.textContent!.replace(targetToken, '');
        } else {
          th.style.width = '1%';
          th.style.whiteSpace = 'nowrap';
        }
      });
      table.querySelectorAll('tbody tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach((td, index) => {
          if (index !== expandIndex) {
            td.style.whiteSpace = 'nowrap';
          }
        });
      });
    }));
