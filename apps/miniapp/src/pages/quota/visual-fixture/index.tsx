import { View } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import { PaymentConfirmSheet, PaymentResultPanel } from '@juben-sha/miniapp-ui';
import { CONFIRM_SHEET_FIXTURE, PENDING_RESULT_FIXTURE } from './fixtures';
import './index.scss';

export default function QuotaVisualFixture() {
  const router = useRouter();
  const state = (router.params.state as string) || 'confirm-sheet';

  if (state === 'result-pending') {
    return (
      <View className="visual-fixture visual-fixture--pending">
        <View className="visual-fixture__spacer" />
        <PaymentResultPanel
          tone="pending"
          title="支付尚未完成"
          message="点数暂未到账。若已扣款，请先核实支付结果，避免重复付款。"
          points={PENDING_RESULT_FIXTURE.points}
          packageName={PENDING_RESULT_FIXTURE.packageName}
          amountLabel={PENDING_RESULT_FIXTURE.amountLabel}
          balancePoints={PENDING_RESULT_FIXTURE.balancePoints}
          orderNo={PENDING_RESULT_FIXTURE.orderNo}
          primaryText="返回订单"
          secondaryText="返回选购"
          onPrimary={() => undefined}
          onSecondary={() => undefined}
        />
      </View>
    );
  }

  return (
    <View className="visual-fixture visual-fixture--confirm">
      <PaymentConfirmSheet
        visible
        packageName={CONFIRM_SHEET_FIXTURE.packageName}
        points={CONFIRM_SHEET_FIXTURE.points}
        amountCents={CONFIRM_SHEET_FIXTURE.amountCents}
        balanceAfterPoints={CONFIRM_SHEET_FIXTURE.balanceAfterPoints}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    </View>
  );
}

definePageConfig({
  navigationStyle: 'custom',
  backgroundColor: '#8A837B',
  backgroundTextStyle: 'light',
});
