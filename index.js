import express from 'express';
import cors from 'cors';
import 'dotenv/config';



const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 5000;


app.get('/', (req, res) => {
    res.send({
        success: true,
        message: 'Server is running',
    });
});


if (process.env.NODE_ENV !== "development") {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

export default app;