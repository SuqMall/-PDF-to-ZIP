const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './tmp/uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename to prevent directory traversal attacks
    const sanitizedName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${sanitizedName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit per file
  },
  fileFilter: (req, file, cb) => {
    // Validate file type
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Serve static files (if needed)
app.use(express.static('public'));

// Enable CORS for cross-origin requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// API endpoint to create ZIP from PDFs
app.post('/api/create-zip', upload.array('pdfFiles', 50), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF files uploaded' });
    }

    // Create a new ZIP archive
    const zip = new AdmZip();
    const outputDir = './tmp/zips';
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Add each PDF to the ZIP
    req.files.forEach(file => {
      const originalName = req.body.originalNames 
        ? JSON.parse(req.body.originalNames)[file.fieldname] 
        : file.originalname;
      zip.addLocalFile(file.path, '', originalName);
    });

    // Generate a unique filename for the ZIP
    const zipFileName = `pdf-archive-${Date.now()}.zip`;
    const zipFilePath = path.join(outputDir, zipFileName);
    
    // Save the ZIP file
    zip.writeZip(zipFilePath);

    // Set up cleanup after response is sent
    res.on('finish', () => {
      // Clean up uploaded files
      req.files.forEach(file => {
        fs.unlink(file.path, (err) => {
          if (err) console.error('Error deleting file:', err);
        });
      });

      // Schedule ZIP file deletion after 1 hour
      setTimeout(() => {
        fs.unlink(zipFilePath, (err) => {
          if (err) console.error('Error deleting ZIP file:', err);
        });
      }, 3600000); // 1 hour
    });

    // Send the ZIP file for download
    res.download(zipFilePath, zipFileName, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).json({ error: 'Failed to create ZIP file' });
      }
    });

  } catch (error) {
    console.error('Error processing files:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
  }
  
  res.status(500).json({ error: error.message });
});

// Start server
app.listen(port, () => {
  console.log(`PDF to ZIP converter server running on port ${port}`);
});

// Cleanup on server shutdown
process.on('SIGINT', () => {
  console.log('Server shutting down, cleaning up temporary files...');
  
  // Delete temporary directories
  const deleteFolderRecursive = (path) => {
    if (fs.existsSync(path)) {
      fs.readdirSync(path).forEach((file) => {
        const curPath = path + '/' + file;
        if (fs.lstatSync(curPath).isDirectory()) {
          deleteFolderRecursive(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(path);
    }
  };
  
  deleteFolderRecursive('./tmp');
  process.exit(0);
});
