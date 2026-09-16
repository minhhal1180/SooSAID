import { maskPhone, redactContext, redactText } from './safe-logger';

/**
 * Rule 11 là ràng buộc bảo mật, không phải khuyến nghị. Test ở đây kiểm tra
 * logger CHỦ ĐỘNG lọc, chứ không dựa vào kỷ luật của người viết code.
 */
describe('SafeLogger – lọc dữ liệu nhạy cảm (Rule 11)', () => {
  describe('maskPhone', () => {
    it('chỉ giữ 3 số cuối', () => {
      expect(maskPhone('+84901234567')).toBe('***567');
      expect(maskPhone('0901234567')).toBe('***567');
    });

    it('che hoàn toàn chuỗi quá ngắn để không lộ gì', () => {
      expect(maskPhone('12')).toBe('[REDACTED]');
    });
  });

  describe('redactText', () => {
    it('che số điện thoại trong message tự do', () => {
      expect(redactText('Gui OTP toi +84901234567 that bai')).toBe(
        'Gui OTP toi ***567 that bai',
      );
    });

    it('che JWT', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiJ9xxxxx.eyJzdWIiOiIxMjM0NTY3ODkwIn0yyyyy.SflKxwRJSMeKKF2QT4fwpzz';
      expect(redactText(`token=${jwt}`)).toBe('token=[REDACTED]');
    });

    it('che presigned URL', () => {
      const url = 'https://storage.example.com/video.mp4?X-Amz-Signature=abc123def';
      expect(redactText(`media ${url}`)).toContain('[REDACTED]');
      expect(redactText(`media ${url}`)).not.toContain('X-Amz-Signature');
    });

    it('giữ nguyên nội dung vô hại', () => {
      expect(redactText('case_created status=QUEUED')).toBe('case_created status=QUEUED');
    });

    it('KHÔNG che mã ca – Rule 11 cho phép log caseCode', () => {
      expect(redactText('case_created code=SOS-20260916-000021')).toBe(
        'case_created code=SOS-20260916-000021',
      );
    });

    it('KHÔNG che UUID – Rule 11 cho phép log caseId/userId', () => {
      const uuid = '22222222-2222-4222-8222-222222222222';
      expect(redactText(`operatorId=${uuid}`)).toBe(`operatorId=${uuid}`);
      expect(redactText('caseId=3c5a6ac0-0bda-47e8-b2f3-e4218f328a2d')).toBe(
        'caseId=3c5a6ac0-0bda-47e8-b2f3-e4218f328a2d',
      );
    });

    it('vẫn che số điện thoại đứng cạnh dấu câu thông thường', () => {
      expect(redactText('lien he (0901234567) gap')).toBe('lien he (***567) gap');
    });
  });

  describe('redactContext', () => {
    it('giữ đúng các khoá được Rule 11 cho phép', () => {
      const safe = redactContext({
        caseId: 'case-1',
        userId: 'user-1',
        event: 'case.created',
        status: 'QUEUED',
        requestId: 'req-1',
      });

      expect(safe).toEqual({
        caseId: 'case-1',
        userId: 'user-1',
        event: 'case.created',
        status: 'QUEUED',
        requestId: 'req-1',
      });
    });

    it('loại bỏ mọi khoá ngoài allow-list, kể cả khi lập trình viên vô tình truyền vào', () => {
      const safe = redactContext({
        caseId: 'case-1',
        phone: '+84901234567',
        bloodType: 'O',
        allergies: ['penicillin'],
        accessToken: 'secret-token',
        videoUrl: 'https://cdn/x?sig=y',
        latitude: 21.02,
      });

      expect(safe).toEqual({ caseId: 'case-1' });
    });

    it('vẫn che giá trị nhạy cảm lọt vào một khoá hợp lệ', () => {
      const safe = redactContext({ event: 'gui toi +84901234567' });
      expect(safe.event).toBe('gui toi ***567');
    });
  });
});
