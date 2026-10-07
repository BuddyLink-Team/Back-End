import dns from 'node:dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Ensure Google DNS is used for SRV resolution on Node on Windows
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore if not allowed
}

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in .env');
  process.exit(1);
}

async function seedChatData() {
  console.log('🔄 Đang kết nối tới MongoDB Atlas...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Đã kết nối MongoDB thành công!');

  const db = mongoose.connection.db;
  const parentsCol = db.collection('parents');
  const usersCol = db.collection('users');
  const childrenCol = db.collection('children');
  const playdatesCol = db.collection('playdates');
  const conversationsCol = db.collection('conversations');
  const messagesCol = db.collection('messages');

  // 1. Fetch existing parents
  let allParents = await parentsCol.find({}).toArray();
  console.log(`📋 Tìm thấy ${allParents.length} phụ huynh trong database.`);

  if (allParents.length === 0) {
    console.error('❌ Chưa có tài khoản phụ huynh nào trong database. Vui lòng tạo tài khoản trước.');
    await mongoose.disconnect();
    return;
  }

  // Ensure we have at least 3 parents with clear names and avatars
  const parent1 = allParents[0];
  const parent2 = allParents[1] || allParents[0];
  let parent3 = allParents[2];

  // If parent3 doesn't exist, create a mock third parent so group chat has 3 parents
  if (!parent3) {
    const mockUserId = new mongoose.Types.ObjectId();
    await usersCol.insertOne({
      _id: mockUserId,
      email: 'maianh.nguyen@buddylink.vn',
      phone: '0912345678',
      role: 'PARENT',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mockParentId = new mongoose.Types.ObjectId();
    const newParent = {
      _id: mockParentId,
      userId: mockUserId,
      fullName: 'Nguyễn Thị Mai Anh',
      avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80',
      bio: 'Mẹ của bé Bông, thích cho con giao lưu và tham gia các hoạt động ngoại khóa.',
      location: {
        coordinates: { type: 'Point', coordinates: [106.69, 10.78] },
        address: 'Phường Đa Kao, Quận 1',
        area: 'Quận 1',
        city: 'Hồ Chí Minh',
      },
      preferences: {
        preferredAgeRange: { min: 2, max: 6 },
        preferredPlaydateDays: ['weekend'],
        preferredTimeSlots: ['afternoon'],
        preferredLocations: ['park'],
        maxDistanceKm: 10,
      },
      privacySettings: {
        isProfileHidden: false,
        connectionPrivacy: 'everyone',
        messagePrivacy: 'everyone',
      },
      verification: {
        isEmailVerified: true,
        isPhoneVerified: true,
        isVerifiedParent: true,
      },
      streak: { currentWeeklyStreak: 1, longestStreak: 2 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await parentsCol.insertOne(newParent);
    parent3 = newParent;
    console.log('✨ Đã tạo thêm phụ huynh mẫu: Nguyễn Thị Mai Anh');
  }

  // Update friendly avatars & verifications if empty
  await parentsCol.updateOne(
    { _id: parent1._id },
    {
      $set: {
        avatarUrl: parent1.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
        fullName: parent1.fullName || 'Lê Ánh Nhật',
        'verification.isVerifiedParent': true,
        'verification.isEmailVerified': true,
        'verification.isPhoneVerified': true,
        'location.area': parent1.location?.area || 'Phú Nhuận',
        'location.city': parent1.location?.city || 'Hồ Chí Minh',
      },
    }
  );

  await parentsCol.updateOne(
    { _id: parent2._id },
    {
      $set: {
        avatarUrl: parent2.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
        fullName: parent2.fullName || 'Thành Anh Huân',
        'verification.isVerifiedParent': true,
        'verification.isEmailVerified': true,
        'verification.isPhoneVerified': true,
        'location.area': parent2.location?.area || 'Quận 1',
        'location.city': parent2.location?.city || 'Hồ Chí Minh',
      },
    }
  );

  if (parent3) {
    await parentsCol.updateOne(
      { _id: parent3._id },
      {
        $set: {
          avatarUrl: parent3.avatarUrl || 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80',
          fullName: parent3.fullName || 'Nguyễn Thị Mai Anh',
          'verification.isVerifiedParent': true,
          'verification.isEmailVerified': true,
          'verification.isPhoneVerified': true,
          'location.area': parent3.location?.area || 'Bình Thạnh',
          'location.city': parent3.location?.city || 'Hồ Chí Minh',
        },
      }
    );
  }

  // 2. Ensure children exist for all parents
  let child1 = await childrenCol.findOne({ parentId: parent1._id });
  if (!child1) {
    const c1Id = new mongoose.Types.ObjectId();
    child1 = {
      _id: c1Id,
      parentId: parent1._id,
      displayName: 'Bé Bo',
      dateOfBirth: new Date('2021-05-15'),
      gender: 'boy',
      interests: ['Lego', 'Khủng long', 'Vẽ tranh'],
      favoriteActivities: ['Đạp xe', 'Đi công viên'],
      personality: ['Năng động', 'Sáng tạo'],
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await childrenCol.insertOne(child1);
    console.log('✨ Đã tạo hồ sơ cho Bé Bo (Con của phụ huynh 1)');
  }

  let child2 = await childrenCol.findOne({ parentId: parent2._id });
  if (!child2) {
    const c2Id = new mongoose.Types.ObjectId();
    child2 = {
      _id: c2Id,
      parentId: parent2._id,
      displayName: 'Bé Linh',
      dateOfBirth: new Date('2021-08-20'),
      gender: 'girl',
      interests: ['Búp bê', 'Tô màu', 'Âm nhạc'],
      favoriteActivities: ['Đọc sách', 'Xếp hình'],
      personality: ['Điềm tĩnh', 'Khéo tay'],
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await childrenCol.insertOne(child2);
    console.log('✨ Đã tạo hồ sơ cho Bé Linh (Con của phụ huynh 2)');
  } else {
    // Ensure interests and display name are clean
    await childrenCol.updateOne(
      { _id: child2._id },
      {
        $set: {
          displayName: child2.displayName || 'Bé Linh',
          gender: child2.gender || 'girl',
          interests: child2.interests?.length ? child2.interests : ['Búp bê', 'Tô màu', 'Âm nhạc'],
        },
      }
    );
  }

  let child3 = parent3 ? await childrenCol.findOne({ parentId: parent3._id }) : null;
  if (parent3 && !child3) {
    const c3Id = new mongoose.Types.ObjectId();
    child3 = {
      _id: c3Id,
      parentId: parent3._id,
      displayName: 'Bé Bông',
      dateOfBirth: new Date('2022-02-10'),
      gender: 'girl',
      interests: ['Kể chuyện', 'Thả diều', 'Tô màu nước'],
      favoriteActivities: ['Đi công viên', 'Ca hát'],
      personality: ['Tình cảm', 'Hòa đồng'],
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await childrenCol.insertOne(child3);
    console.log('✨ Đã tạo hồ sơ cho Bé Bông (Con của phụ huynh 3)');
  }

  // 3. Clear existing seeded test conversations and messages to avoid duplicates
  await conversationsCol.deleteMany({});
  await messagesCol.deleteMany({});
  await playdatesCol.deleteMany({});
  console.log('🧹 Đã dọn sạch các cuộc hội thoại và tin nhắn cũ để tạo mới.');

  const now = new Date();
  const m = (minutesAgo) => new Date(Date.now() - minutesAgo * 60 * 1000);

  // =========================================================================
  // CONVERSATION 1: Direct Chat (Lê Ánh Nhật <-> Thành Anh Huân)
  // =========================================================================
  const directConvId = new mongoose.Types.ObjectId();
  const directMessages = [
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: directConvId,
      senderId: parent2._id,
      type: 'text',
      content: 'Chào anh Nhật! Hôm trước thấy bé Bo chơi Lego ở khu vui chơi tập trung thích ghê!',
      mediaUrl: null,
      readBy: [{ parentId: parent2._id, readAt: m(60) }, { parentId: parent1._id, readAt: m(50) }],
      isDeleted: false,
      createdAt: m(60),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: directConvId,
      senderId: parent1._id,
      type: 'text',
      content: 'Chào anh Huân! Dạ bé Bo nhà mình mê Lego lắm, cứ ngồi lắp ráp cả buổi không chán haha.',
      mediaUrl: null,
      readBy: [{ parentId: parent1._id, readAt: m(45) }, { parentId: parent2._id, readAt: m(40) }],
      isDeleted: false,
      createdAt: m(45),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: directConvId,
      senderId: parent2._id,
      type: 'text',
      content: 'Bé Linh nhà mình cũng thích tô màu với xếp hình khối. Cuối tuần này anh có rảnh cho 2 bé gặp nhau giao lưu không?',
      mediaUrl: null,
      readBy: [{ parentId: parent2._id, readAt: m(30) }, { parentId: parent1._id, readAt: m(25) }],
      isDeleted: false,
      createdAt: m(30),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: directConvId,
      senderId: parent1._id,
      type: 'text',
      content: 'Ý tưởng hay quá! Thứ Bảy tuần này mình định cho bé ra Công viên Gia Định chạy nhảy, tầm 15h30 chiều cho mát nè.',
      mediaUrl: null,
      readBy: [{ parentId: parent1._id, readAt: m(20) }, { parentId: parent2._id, readAt: m(18) }],
      isDeleted: false,
      createdAt: m(20),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: directConvId,
      senderId: parent1._id,
      type: 'image',
      content: '[Hình ảnh]',
      mediaUrl: 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&auto=format&fit=crop&q=80',
      readBy: [{ parentId: parent1._id, readAt: m(15) }, { parentId: parent2._id, readAt: m(12) }],
      isDeleted: false,
      createdAt: m(15),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: directConvId,
      senderId: parent1._id,
      type: 'text',
      content: 'Hôm nay bé Bo mới khoe bức tranh bé vẽ tàu vũ trụ nè anh xem thử, dễ thương ghê! 🚀🎨',
      mediaUrl: null,
      readBy: [{ parentId: parent1._id, readAt: m(14) }, { parentId: parent2._id, readAt: m(10) }],
      isDeleted: false,
      createdAt: m(14),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: directConvId,
      senderId: parent2._id,
      type: 'text',
      content: 'Bé vẽ sáng tạo quá chừng! Tuyệt vời, chiều thứ Bảy hẹn gặp 2 bố con ở Công viên Gia Định nhé! 🌳☀️',
      mediaUrl: null,
      readBy: [{ parentId: parent2._id, readAt: m(5) }],
      isDeleted: false,
      createdAt: m(5),
    },
  ];

  await messagesCol.insertMany(directMessages);
  const lastDirectMsg = directMessages[directMessages.length - 1];

  await conversationsCol.insertOne({
    _id: directConvId,
    type: 'direct',
    participants: [parent1._id, parent2._id],
    playdateId: null,
    lastMessage: {
      messageId: lastDirectMsg._id,
      senderId: lastDirectMsg.senderId,
      content: lastDirectMsg.content,
      type: lastDirectMsg.type,
      sentAt: lastDirectMsg.createdAt,
    },
    unreadCounts: {
      [parent1._id.toString()]: 1, // 1 unread message for parent1 to test unread badge
      [parent2._id.toString()]: 0,
    },
    isActive: true,
    createdAt: m(60),
    updatedAt: lastDirectMsg.createdAt,
  });

  console.log(`✅ [1/3] Đã tạo cuộc hội thoại trực tiếp: ${parent1.fullName} <-> ${parent2.fullName}`);

  // =========================================================================
  // CONVERSATION 2: Playdate Group Chat with Event Collateral Panel (TASK-BE-11 & TASK-FE-11)
  // =========================================================================
  const playdateId = new mongoose.Types.ObjectId();
  const playdateConvId = new mongoose.Types.ObjectId();

  // Scheduled date: Next Saturday at 15:30
  const scheduledDate = new Date();
  scheduledDate.setDate(scheduledDate.getDate() + ((6 - scheduledDate.getDay() + 7) % 7 || 7));
  scheduledDate.setHours(15, 30, 0, 0);

  const playdateDoc = {
    _id: playdateId,
    hostParentId: parent1._id,
    hostChildId: child1._id,
    participants: [
      {
        parentId: parent2._id,
        childId: child2._id,
        status: 'accepted',
        invitedAt: m(120),
        respondedAt: m(100),
      },
      ...(parent3 && child3
        ? [
            {
              parentId: parent3._id,
              childId: child3._id,
              status: 'accepted',
              invitedAt: m(110),
              respondedAt: m(90),
            },
          ]
        : []),
    ],
    scheduledDate,
    time: '15:30',
    activity: 'Buổi vẽ tranh sáng tạo & thả diều cuối tuần',
    location: {
      name: 'Công viên Gia Định',
      address: 'Hoàng Minh Giám, Phường 9, Phú Nhuận, TP. Hồ Chí Minh',
      placeId: 'ChIJb_xUv7EvNTERR9xU_SAMPLE',
      coordinates: {
        type: 'Point',
        coordinates: [106.6784, 10.8172],
      },
    },
    note: 'Các bố mẹ nhớ mang theo nón rộng vành, bình nước lọc và khăn lau cho các bé nhé. Nhà mình sẽ chuẩn bị sẵn giấy vẽ và màu sáp cho các con!',
    status: 'upcoming',
    cancellation: null,
    completedAt: null,
    chatConversationId: playdateConvId,
    createdAt: m(120),
    updatedAt: m(2),
  };

  await playdatesCol.insertOne(playdateDoc);

  const groupMessages = [
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: playdateConvId,
      senderId: parent1._id,
      type: 'text',
      content: 'Chào cả nhà! Mình tạo nhóm trò chuyện để các gia đình tiện theo dõi lịch trình cho buổi vẽ tranh & thả diều thứ Bảy tới nhé!',
      mediaUrl: null,
      readBy: [{ parentId: parent1._id, readAt: m(95) }, { parentId: parent2._id, readAt: m(90) }],
      isDeleted: false,
      createdAt: m(95),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: playdateConvId,
      senderId: parent2._id,
      type: 'text',
      content: 'Chào anh Nhật và mẹ Mai Anh! Bé Linh nhà mình đã chuẩn bị sẵn hộp bút sáp màu và mấy cuộn dây diều rồi ạ.',
      mediaUrl: null,
      readBy: [{ parentId: parent2._id, readAt: m(70) }, { parentId: parent1._id, readAt: m(65) }],
      isDeleted: false,
      createdAt: m(70),
    },
    ...(parent3
      ? [
          {
            _id: new mongoose.Types.ObjectId(),
            conversationId: playdateConvId,
            senderId: parent3._id,
            type: 'text',
            content: 'Chào 2 gia đình! Bé Bông thích vẽ lắm, em sẽ làm thêm ít bánh flan nhỏ mang theo mời các bé ăn xế nhé! 🍮',
            mediaUrl: null,
            readBy: [{ parentId: parent3._id, readAt: m(50) }],
            isDeleted: false,
            createdAt: m(50),
          },
        ]
      : []),
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: playdateConvId,
      senderId: parent1._id,
      type: 'image',
      content: '[Hình ảnh]',
      mediaUrl: 'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=800&auto=format&fit=crop&q=80',
      readBy: [{ parentId: parent1._id, readAt: m(30) }],
      isDeleted: false,
      createdAt: m(30),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: playdateConvId,
      senderId: parent1._id,
      type: 'text',
      content: 'Khu vực bãi cỏ gần đài phun nước trung tâm rất rộng và sạch sẽ như hình này nè, mọi người đi cổng đường Hoàng Minh Giám vào là thấy ngay nhé!',
      mediaUrl: null,
      readBy: [{ parentId: parent1._id, readAt: m(28) }],
      isDeleted: false,
      createdAt: m(28),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      conversationId: playdateConvId,
      senderId: parent2._id,
      type: 'text',
      content: 'Dạ quá tuyệt vời! Bé Linh và bố đếm từng ngày để được gặp bé Bo với bé Bông đây ạ! Hẹn gặp cả nhà lúc 15h30 thứ Bảy! 🎉🪁',
      mediaUrl: null,
      readBy: [{ parentId: parent2._id, readAt: m(2) }],
      isDeleted: false,
      createdAt: m(2),
    },
  ];

  await messagesCol.insertMany(groupMessages);
  const lastGroupMsg = groupMessages[groupMessages.length - 1];

  const groupParticipants = [parent1._id, parent2._id, ...(parent3 ? [parent3._id] : [])];
  await conversationsCol.insertOne({
    _id: playdateConvId,
    type: 'playdate',
    participants: groupParticipants,
    playdateId: playdateId,
    lastMessage: {
      messageId: lastGroupMsg._id,
      senderId: lastGroupMsg.senderId,
      content: lastGroupMsg.content,
      type: lastGroupMsg.type,
      sentAt: lastGroupMsg.createdAt,
    },
    unreadCounts: {
      [parent1._id.toString()]: 0,
      [parent2._id.toString()]: 0,
      ...(parent3 ? { [parent3._id.toString()]: 1 } : {}),
    },
    isActive: true,
    createdAt: m(120),
    updatedAt: lastGroupMsg.createdAt,
  });

  console.log(`✅ [2/3] Đã tạo nhóm Playdate Chat: "${playdateDoc.activity}" (Playdate ID: ${playdateId})`);

  // =========================================================================
  // CONVERSATION 3: Direct Chat 2 (Lê Ánh Nhật <-> Nguyễn Thị Mai Anh)
  // =========================================================================
  if (parent3) {
    const direct2ConvId = new mongoose.Types.ObjectId();
    const direct2Messages = [
      {
        _id: new mongoose.Types.ObjectId(),
        conversationId: direct2ConvId,
        senderId: parent3._id,
        type: 'text',
        content: 'Chào anh Nhật! Em thấy trên hồ sơ bé Bo có cùng sở thích lắp ráp mô hình với bé Bông nhà em nè.',
        mediaUrl: null,
        readBy: [{ parentId: parent3._id, readAt: m(180) }, { parentId: parent1._id, readAt: m(170) }],
        isDeleted: false,
        createdAt: m(180),
      },
      {
        _id: new mongoose.Types.ObjectId(),
        conversationId: direct2ConvId,
        senderId: parent1._id,
        type: 'text',
        content: 'Chào chị Mai Anh! Đúng rồi chị, các bé tầm tuổi này chơi xếp hình kích thích tư duy sáng tạo rất tốt đó ạ.',
        mediaUrl: null,
        readBy: [{ parentId: parent1._id, readAt: m(160) }, { parentId: parent3._id, readAt: m(150) }],
        isDeleted: false,
        createdAt: m(160),
      },
      {
        _id: new mongoose.Types.ObjectId(),
        conversationId: direct2ConvId,
        senderId: parent3._id,
        type: 'text',
        content: 'Dạ vâng anh, hẹn gặp anh và bé Bo vào chiều thứ Bảy này ở công viên nhé!',
        mediaUrl: null,
        readBy: [{ parentId: parent3._id, readAt: m(120) }, { parentId: parent1._id, readAt: m(110) }],
        isDeleted: false,
        createdAt: m(120),
      },
    ];

    await messagesCol.insertMany(direct2Messages);
    const lastDirect2Msg = direct2Messages[direct2Messages.length - 1];

    await conversationsCol.insertOne({
      _id: direct2ConvId,
      type: 'direct',
      participants: [parent1._id, parent3._id],
      playdateId: null,
      lastMessage: {
        messageId: lastDirect2Msg._id,
        senderId: lastDirect2Msg.senderId,
        content: lastDirect2Msg.content,
        type: lastDirect2Msg.type,
        sentAt: lastDirect2Msg.createdAt,
      },
      unreadCounts: {
        [parent1._id.toString()]: 0,
        [parent3._id.toString()]: 0,
      },
      isActive: true,
      createdAt: m(180),
      updatedAt: lastDirect2Msg.createdAt,
    });

    console.log(`✅ [3/3] Đã tạo cuộc hội thoại trực tiếp: ${parent1.fullName} <-> ${parent3.fullName}`);
  }

  console.log('\n=========================================================================');
  console.log('🎉 DỮ LIỆU CHAT ĐÃ ĐƯỢC INSERT THÀNH CÔNG VÀO MONGODB!');
  console.log('=========================================================================');
  console.log('📌 Danh sách cuộc hội thoại đã tạo:');
  console.log(`1. Trò chuyện trực tiếp: /chat/${directConvId}`);
  console.log(`2. Nhóm Playdate:        /chat/playdate/${playdateId} (hoặc /chat/${playdateConvId})`);
  if (parent3) {
    console.log(`3. Trò chuyện trực tiếp: /chat với ${parent3.fullName}`);
  }
  console.log('\n👉 Bạn có thể mở trình duyệt vào http://localhost:5173/chat hoặc http://localhost:5173/chat/playdate/' + playdateId + ' để trải nghiệm ngay!');

  await mongoose.disconnect();
}

seedChatData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Lỗi khi insert data:', err);
    process.exit(1);
  });
