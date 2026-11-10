/**
 * Concrete games of each catalog activity (key of PLAYDATE_ACTIVITIES), so the main activities of a playdate
 * follow the activity the parent picked instead of a few generic games.
 *
 * title:     a few words, what the children play or make
 * minAge / maxAge: every child of the group should be within this range
 * minutes:   usual length of the game
 * riskLevel / supervisionLevel: same scale as the catalog (safety-rules.js reads them)
 */
const game = (title, minAge, maxAge, minutes, riskLevel = 'low', supervisionLevel = 'minimal') => ({
  title,
  minAge,
  maxAge,
  minutes,
  riskLevel,
  supervisionLevel,
});

export const ACTIVITY_GAMES = Object.freeze({
  'Dã ngoại ngoài trời': [
    game('Trải thảm picnic & chia sẻ đồ ăn nhẹ', 2, 14, 20),
    game('Truy tìm kho báu bằng bản đồ vẽ tay', 4, 14, 25, 'low', 'normal'),
    game('Rồng rắn lên mây', 3, 10, 15, 'low', 'normal'),
    game('Nhặt lá cây làm tranh thiên nhiên', 3, 12, 20),
    game('Kéo co mini theo đội', 5, 14, 15, 'low', 'normal'),
    game('Bịt mắt bắt dê trên bãi cỏ', 4, 12, 15, 'low', 'normal'),
    game('Thổi bong bóng xà phòng khổng lồ', 2, 10, 15),
  ],
  'Chơi cát & Tắm biển': [
    game('Thi xây lâu đài cát theo đội', 3, 14, 30, 'medium', 'normal'),
    game('Truy tìm vỏ sò và đá đẹp', 3, 12, 20, 'low', 'normal'),
    game('Vẽ tranh trên cát bằng que', 3, 12, 15),
    game('Đá bóng chân trần trên cát', 5, 14, 20, 'medium', 'normal'),
    game('Nghịch sóng ở mép nước có người lớn kèm', 3, 14, 20, 'high', 'dedicated_1to1'),
  ],
  'Thả diều': [
    game('Trang trí đuôi diều bằng ruy băng', 4, 12, 20),
    game('Thi thả diều bay cao nhất', 5, 14, 25, 'low', 'normal'),
    game('Chạy tiếp sức cầm diều', 5, 12, 15, 'low', 'normal'),
    game('Vẽ mặt cười lên cánh diều giấy', 4, 10, 20),
    game('Ngắm mây đoán hình con vật', 4, 12, 10),
  ],
  'Tham quan vườn thú': [
    game('Săn ảnh 5 con vật yêu thích', 3, 12, 30, 'low', 'normal'),
    game('Đố vui tiếng kêu các con vật', 2, 10, 15),
    game('Bắt chước dáng đi của con vật', 2, 8, 15),
    game('Phiếu bingo con vật tìm thấy', 4, 12, 30, 'low', 'normal'),
    game('Xem giờ cho thú ăn & hỏi đáp', 3, 12, 20, 'low', 'normal'),
  ],
  'Làm vườn & Trồng cây': [
    game('Gieo hạt rau mầm vào cốc giấy', 3, 12, 20),
    game('Trang trí chậu cây bằng màu vẽ', 3, 12, 25),
    game('Tưới cây & ghi nhật ký cây lớn', 4, 14, 15),
    game('Tìm côn trùng nhỏ bằng kính lúp', 4, 12, 20, 'low', 'normal'),
    game('Ghép lá cây thành con vật', 3, 10, 20),
  ],
  'Đạp xe công viên': [
    game('Đạp xe vòng quanh hồ theo nhóm', 5, 16, 25, 'medium', 'normal'),
    game('Thi đạp xe chậm mà không chạm chân', 5, 14, 15, 'medium', 'normal'),
    game('Vượt chướng ngại vật bằng cọc nón', 5, 14, 20, 'medium', 'normal'),
    game('Học luật đi đường với biển báo đồ chơi', 4, 10, 15),
    game('Đạp xe theo đèn xanh đèn đỏ', 4, 10, 15, 'medium', 'normal'),
  ],
  'Bơi lội': [
    game('Khởi động & làm quen nước có phao', 4, 16, 15, 'high', 'dedicated_1to1'),
    game('Nhặt đồ chơi dưới đáy hồ cạn', 5, 14, 15, 'high', 'dedicated_1to1'),
    game('Thi đạp chân bám thành hồ', 4, 12, 15, 'high', 'dedicated_1to1'),
    game('Chuyền bóng trong hồ cạn', 5, 16, 15, 'high', 'high_vigilance'),
    game('Thổi bong bóng nước tập thở', 4, 10, 10, 'high', 'dedicated_1to1'),
  ],
  'Bóng đá / Thể thao': [
    game('Dẫn bóng zíc zắc qua cọc', 4, 16, 15, 'low', 'normal'),
    game('Sút bóng vào khung thành mini', 4, 16, 15, 'low', 'normal'),
    game('Trận đấu giao hữu 3 chọi 3', 6, 16, 25, 'medium', 'normal'),
    game('Chạy tiếp sức chuyền bóng', 4, 14, 15, 'low', 'normal'),
    game('Thử thách tâng bóng đếm số', 6, 16, 10),
    game('Ném bóng trúng đích', 3, 12, 15),
  ],
  'Trượt patin': [
    game('Khởi động & tập đứng vững trên patin', 5, 16, 15, 'medium', 'normal'),
    game('Trượt zíc zắc qua cọc nón', 6, 16, 20, 'medium', 'normal'),
    game('Trượt theo đoàn tàu nắm tay', 6, 16, 15, 'medium', 'high_vigilance'),
    game('Thi dừng lại đúng vạch', 6, 16, 10, 'medium', 'normal'),
    game('Trượt theo nhạc & đóng băng', 5, 14, 15, 'medium', 'normal'),
  ],
  'Xếp hình Lego': [
    game('Thi xây thành phố Lego theo chủ đề', 4, 12, 30),
    game('Thử thách xây cầu Lego chịu lực', 6, 12, 25),
    game('Xây tòa tháp Lego cao nhất', 3, 10, 15),
    game('Ghép Lego theo hình mẫu', 4, 12, 20),
    game('Kể chuyện với nhân vật Lego vừa xây', 4, 12, 20),
    game('Đua xe Lego tự lắp', 5, 12, 20),
  ],
  'Vẽ tranh': [
    game('Vẽ tranh màu nước về thiên nhiên', 3, 14, 25),
    game('Vẽ tiếp sức một bức tranh chung', 4, 12, 20),
    game('In tranh bằng bàn tay & lá cây', 2, 8, 20),
    game('Vẽ chân dung bạn chơi', 5, 14, 20),
    game('Tô màu mandala thư giãn', 5, 14, 20),
    game('Triển lãm mini & kể về bức tranh', 3, 12, 15),
  ],
  'Thủ công sáng tạo': [
    game('Nặn con vật bằng đất nặn', 3, 12, 25),
    game('Làm vòng tay bằng hạt cườm', 5, 12, 25, 'medium', 'normal'),
    game('Gấp giấy origami con vật', 5, 14, 20),
    game('Làm mặt nạ giấy siêu anh hùng', 4, 12, 25),
    game('Làm búp bê que kem kể chuyện', 4, 10, 25),
    game('Cắt dán thiệp tặng bạn', 4, 12, 20, 'low', 'normal'),
  ],
  'Làm bánh & Nấu ăn': [
    game('Trang trí bánh quy bằng kem màu', 4, 14, 25, 'low', 'normal'),
    game('Nặn bánh quy hình con vật', 4, 12, 25, 'medium', 'normal'),
    game('Làm sandwich hình mặt cười', 4, 12, 20, 'low', 'normal'),
    game('Xiên que trái cây cầu vồng', 4, 12, 20, 'medium', 'normal'),
    game('Thi "đầu bếp nhí" trình bày món', 5, 14, 15),
    game('Pha nước trái cây cùng nhau', 4, 12, 15, 'low', 'normal'),
  ],
  'Âm nhạc & Ca hát': [
    game('Hát karaoke bài thiếu nhi yêu thích', 3, 14, 20),
    game('Đoán tên bài hát qua giai điệu', 4, 14, 15),
    game('Làm nhạc cụ từ chai nhựa & hạt đậu', 3, 10, 20),
    game('Nhảy theo nhạc & đóng băng', 2, 12, 15),
    game('Ban nhạc mini gõ nhịp theo bài hát', 3, 12, 20),
  ],
  'Thư viện / Đọc sách': [
    game('Nghe kể chuyện cổ tích', 2, 10, 20),
    game('Đóng vai nhân vật trong truyện', 4, 12, 20),
    game('Vẽ lại đoạn truyện yêu thích', 3, 12, 20),
    game('Đố vui về câu chuyện vừa nghe', 4, 12, 15),
    game('Mỗi bé chọn và giới thiệu một cuốn sách', 5, 14, 15),
  ],
  'Ghé thăm viện bảo tàng': [
    game('Săn hiện vật theo phiếu gợi ý', 5, 16, 30, 'low', 'normal'),
    game('Nghe thuyết minh dành cho thiếu nhi', 5, 16, 20),
    game('Vẽ phác hiện vật ấn tượng nhất', 5, 14, 20),
    game('Đố vui lịch sử sau buổi tham quan', 6, 16, 15),
    game('Chụp ảnh nhóm & kể điều thú vị nhất', 5, 16, 10),
  ],
  'Khám phá khoa học': [
    game('Thí nghiệm núi lửa baking soda', 5, 14, 20, 'medium', 'normal'),
    game('Làm slime an toàn từ bột', 5, 12, 25, 'medium', 'normal'),
    game('Thí nghiệm vật chìm vật nổi', 4, 10, 15),
    game('Chế tạo tên lửa bóng bay', 6, 14, 20, 'low', 'normal'),
    game('Quan sát lá cây bằng kính lúp', 4, 12, 15),
    game('Pha màu cầu vồng trong cốc nước', 4, 10, 15),
  ],
  'Khu vui chơi trong nhà (Kids Cafe)': [
    game('Chơi nhà bóng & cầu trượt', 1, 8, 25, 'medium', 'normal'),
    game('Leo khu vận động liên hoàn', 3, 10, 20, 'medium', 'high_vigilance'),
    game('Đóng vai bán hàng ở góc nhập vai', 3, 10, 20),
    game('Xếp khối xốp khổng lồ', 2, 8, 15),
    game('Tô màu & ăn nhẹ cùng bạn', 3, 10, 20),
  ],
  'Trò chơi tương tác / Board games': [
    game('Cờ cá ngựa theo đội', 5, 14, 25),
    game('Rút gỗ Jenga đồng đội', 6, 16, 15),
    game('Uno phiên bản trẻ em', 5, 14, 20),
    game('Ghép tranh puzzle tiếp sức', 4, 12, 20),
    game('Bingo hình ảnh con vật', 4, 10, 15),
    game('Đố vui ô chữ chủ đề thiếu nhi', 7, 16, 20),
  ],
  'Xem phim hoạt hình': [
    game('Xem phim hoạt hình ngắn cùng nhau', 3, 12, 40),
    game('Đố vui về nhân vật trong phim', 4, 12, 15),
    game('Vẽ nhân vật hoạt hình yêu thích', 3, 12, 20),
    game('Đóng vai một cảnh trong phim', 4, 12, 15),
    game('Làm bắp rang & bình chọn phim hay', 4, 12, 15, 'low', 'normal'),
  ],
  'Chơi cầu trượt & xích đu': [
    game('Thay phiên cầu trượt & xích đu', 1, 8, 20, 'medium', 'normal'),
    game('Trốn tìm quanh sân chơi', 3, 8, 15, 'low', 'normal'),
    game('Đuổi bắt đóng băng', 3, 10, 15, 'low', 'normal'),
    game('Chơi cát & xúc cát ở hố cát', 1, 6, 20),
    game('Leo thang dây có người lớn đỡ', 3, 8, 15, 'medium', 'high_vigilance'),
  ],
});

// Every game of every activity, for the catalog checks (known item, risk)
export const ALL_ACTIVITY_GAMES = Object.freeze(Object.values(ACTIVITY_GAMES).flat());

/**
 * Games of the chosen activity: its own games when it is a catalog activity, otherwise the games of the
 * catalog activities its title names (a typed activity like "đá bóng ở công viên")
 * @param {{ key?: string|null, title?: string }|null} activity
 * @param {(text: string, reference: Object) => boolean} namesGame
 * @param {Array<Object>} catalog - PLAYDATE_ACTIVITIES
 * @returns {Array<Object>}
 */
export const gamesOfActivity = (activity, namesGame, catalog) => {
  if (!activity) return [];
  if (activity.key && ACTIVITY_GAMES[activity.key]) return ACTIVITY_GAMES[activity.key];
  const text = activity.title || '';
  const related = catalog.filter((item) => namesGame(text, item));
  return related.flatMap((item) => ACTIVITY_GAMES[item.key] || []);
};

export default ACTIVITY_GAMES;
