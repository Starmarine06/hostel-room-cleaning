// The blank student sheet: reg.no, name, room, room size (a 1-10 dropdown) and email
export async function downloadStudentTemplate() {
  const { Workbook } = await import('exceljs'); // loaded only when someone asks for the template
  const book = new Workbook();
  const sheet = book.addWorksheet('Students');
  sheet.columns = [
    { header: 'reg.no', key: 'reg', width: 16 },
    { header: 'name', key: 'name', width: 24 },
    { header: 'room', key: 'room', width: 10 },
    { header: 'room size', key: 'size', width: 12 },
    { header: 'email', key: 'email', width: 32 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.addRows([
    ['21BCE0001', 'Student One', 'T-230', 4, 'student1@example.com'],
    ['21BCE0002', 'Student Two', 'T-230', 4, 'student2@example.com'],
  ]);
  // Pick how many people the room holds instead of typing it
  for (let row = 2; row <= 1000; row++) {
    sheet.getCell(`D${row}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"1,2,3,4,5,6,7,8,9,10"'],
      showErrorMessage: true,
      errorTitle: 'Room size',
      error: 'Choose a number from 1 to 10',
    };
  }
  const buffer = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'students-template.xlsx';
  link.click();
  URL.revokeObjectURL(url);
}
