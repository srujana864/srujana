const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const cors = require('cors');
const { ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');
const User = require('./models/User');
const NotificationModel = require('./models/Notification');
// Initialize Express app and other modules
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// MongoDB connection
const mongoURI = 'mongodb://localhost:27017/SPC';
mongoose
  .connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

// Middleware setup
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Models
const projectSchema = new mongoose.Schema({
  projectName: String,
  projectDescription: String,
  members: [{ name: String, task: String, deadline: Date }],
  username: String,
});
const Project = mongoose.model('Project', projectSchema);

const chatRoomSchema = new mongoose.Schema({
  projectName: String,
  members: [String],
});
const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// In-memory chat messages storage
const chatMessages = {};

// Routes

// Fetch chat rooms
app.get('/api/chatrooms', async (req, res) => {
  const { username } = req.query;
  try {
    const chatRooms = await ChatRoom.find({ members: username });
    res.json(chatRooms);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Upload a file
app.post('/api/upload', upload.single('file'), (req, res) => {
  res.status(200).json({ fileUrl: `http://localhost:5000/uploads/${req.file.filename}` });
});

// Get chat messages for a chat group
app.get('/api/chatmessages/:chatGroupId', (req, res) => {
  const { chatGroupId } = req.params;
  res.status(200).json(chatMessages[chatGroupId] || []);
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('joinRoom', (chatGroupId) => {
    socket.join(chatGroupId);
    console.log(`User ${socket.id} joined room ${chatGroupId}`);
  });

  socket.on('chatMessage', (data) => {
    const { chatGroupId, sender, message, fileUrl } = data;
    const newMessage = {
      _id: uuidv4(),
      sender,
      message,
      fileUrl,
      timestamp: new Date(),
    };

    if (!chatMessages[chatGroupId]) {
      chatMessages[chatGroupId] = [];
    }

    chatMessages[chatGroupId].push(newMessage);
    io.to(chatGroupId).emit('chatMessage', newMessage);
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
  });
});

// User routes
app.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username');
    res.json(users);
  } catch (error) {
    console.error('Error fetching user list:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      _id: new ObjectId(),
      username,
      email,
      password: hashedPassword,
    });
    const user = await newUser.save();
    res.json(user);
  } catch (error) {
    console.error('Error registering user:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/signin', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (user) {
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        res.status(200).json({ success: true, role: user.role });
      } else {
        res.status(401).json({ success: false, message: 'Invalid username or password' });
      }
    } else {
      res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
  } catch (error) {
    console.error('Error during authentication:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Project routes
app.post('/createProject', async (req, res) => {
  try {
    const { projectName, projectDescription, members, username } = req.body;
    const project = new Project({
      projectName,
      projectDescription,
      members,
      username,
    });
    const savedProject = await project.save();
    res.status(201).json(savedProject);
  } catch (error) {
    console.error('Error creating project:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/createChatRoom', async (req, res) => {
  try {
    const { projectName, members } = req.body;
    const chatRoom = new ChatRoom({
      projectName,
      members,
    });
    const savedChatRoom = await chatRoom.save();
    res.status(201).json(savedChatRoom);
  } catch (error) {
    console.error('Error creating chat room:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/projects/:projectId/chatRooms', async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const chatRooms = await ChatRoom.find({ projectName: project.projectName });
    res.status(200).json(chatRooms);
  } catch (error) {
    console.error('Error fetching chat rooms:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/projects', async (req, res) => {
  const { username } = req.query;
  try {
    const projects = await Project.find({ username });
    res.status(200).json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/projects/:projectId', async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/projects/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const updatedProject = req.body;

  try {
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (project.username !== updatedProject.username) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update the project details
    Object.assign(project, updatedProject);
    
    // Save the project and handle VersionError by retrying
    await saveProjectWithRetry(project);

    // Update the chatroom with new members
    const chatRoom = await ChatRoom.findOne({ projectName: project.projectName });
    if (chatRoom) {
      chatRoom.members = [...new Set([...chatRoom.members, ...updatedProject.members.map(member => member.name)])];
      await saveChatRoomWithRetry(chatRoom);
    }

    res.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Function to save project with retry logic
const saveProjectWithRetry = async (project, retries = 3) => {
  try {
    await project.save();
  } catch (error) {
    if (error.name === 'VersionError' && retries > 0) {
      console.warn(`VersionError encountered. Retrying... (${retries} retries left)`);
      await saveProjectWithRetry(project, retries - 1);
    } else {
      throw error;
    }
  }
};

// Function to save chatroom with retry logic
const saveChatRoomWithRetry = async (chatRoom, retries = 3) => {
  try {
    await chatRoom.save();
  } catch (error) {
    if (error.name === 'VersionError' && retries > 0) {
      console.warn(`VersionError encountered. Retrying... (${retries} retries left)`);
      await saveChatRoomWithRetry(chatRoom, retries - 1);
    } else {
      throw error;
    }
  }
};


app.get('/tasks/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const tasks = await Project.find({ 'members.name': username });
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.get('/notifications', async (req, res) => {
  try {
    // Fetch notifications from the database
    const notifications = await NotificationModel.find();

    // Retrieve the username from a query parameter
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ error: 'Username query parameter is required' });
    }

    // Fetch all projects that include the user in their members array
    const projects = await Project.find({ 'members.name': username });

    // Iterate over each project to find the user's deadlines and create notifications
    projects.forEach(project => {
      project.members.forEach(member => {
        if (member.name === username) {
          const daysLeft = Math.ceil((new Date(member.deadline) - new Date()) / (1000 * 60 * 60 * 24));
          notifications.push({
            message: `Deadline for ${username} in project ${project.projectName}`,
            deadline: member.deadline,
            daysLeft: daysLeft,
          });
        }
      });
    });

    res.json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
