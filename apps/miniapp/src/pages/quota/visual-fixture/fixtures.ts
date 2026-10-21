export interface ConfirmSheetFixture {
  packageName: string;
  points: number;
  amountCents: number;
  balanceAfterPoints: number;
}

export interface PendingResultFixture {
  points: number;
  packageName: string;
  amountLabel: string;
  balancePoints: number;
  orderNo: string;
}

export const CONFIRM_SHEET_FIXTURE: ConfirmSheetFixture = {
  packageName: '体验包',
  points: 60,
  amountCents: 600,
  balanceAfterPoints: 999,
};

export const PENDING_RESULT_FIXTURE: PendingResultFixture = {
  points: 60,
  packageName: '体验包',
  amountLabel: '¥6.00',
  balancePoints: 999,
  orderNo: 'VISUAL-20261019-0002',
};
