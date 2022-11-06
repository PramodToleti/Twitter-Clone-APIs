const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running at http://localhost:3000/");
    });
  } catch (err) {
    console.log(`DB Error: ${err.message}`);
    process.exit(-1);
  }
};

initializeDBAndServer();

//User Register API
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser !== undefined) {
    response.status = 400;
    response.send("User already exists");
  } else {
    if (password.length < 5) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `
            INSERT INTO 
            user(username, password, name, gender)
            VALUES (
                '${username}',
                '${hashedPassword}',
                '${name}',
                '${gender}'
            );
      `;
      const dbResponse = await db.run(createUserQuery);
      const userId = dbResponse.lastID;
      //console.log(userId);
      response.send("User created successfully");
    }
  }
});

//User Login API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid User");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "SECRET_TOKEN");
      response.send({ jwtToken: jwtToken });
    } else {
      response.status(400);
      response.send("Invalid Password");
    }
  }
});

//User Authentication API
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeaders = request.headers["authorization"];
  if (authHeaders !== undefined) {
    jwtToken = authHeaders.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_TOKEN", async (err, payload) => {
      if (err) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//Get Latest tweets of people whom the user follows
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserQuery = `
    SELECT 
      *
    FROM
      user
    WHERE 
      username = '${username}';
  `;
  const userDetails = await db.get(getUserQuery);
  const userId = userDetails.user_id;
  const getTweetsQuery = `
    SELECT 
        user.username,
        tweet.tweet,
        tweet.date_time
    FROM user 
    INNER JOIN follower ON user.user_id = follower.following_user_id 
    INNER JOIN tweet ON tweet.user_id = follower.following_user_id 
    WHERE follower.follower_user_id = ${userId}
    ORDER BY
      CAST(strftime("%H", tweet.date_time) AS INTEGER) DESC,
      CAST(strftime("%M", tweet.date_time) AS INTEGER) DESC,
      CAST(strftime("%S", tweet.date_time) AS INTEGER) DESC
    LIMIT 4;
  `;
  const dbResponse = await db.all(getTweetsQuery);
  const getTweets = dbResponse.map((obj) => {
    return {
      username: obj.username,
      tweet: obj.tweet,
      dateTime: obj.date_time,
    };
  });
  response.send(getTweets);
});

//Get list of all names of people whom the user follows
app.get("/user/following/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserQuery = `
    SELECT 
      *
    FROM
      user
    WHERE 
      username = '${username}';
  `;
  const userDetails = await db.get(getUserQuery);
  const userId = userDetails.user_id;
  const getUsersQuery = `
    SELECT 
      user.name 
    FROM user 
    INNER JOIN follower ON follower.following_user_id = user.user_id 
    WHERE follower.follower_user_id = ${userId};
  `;
  const dbResponse = await db.all(getUsersQuery);
  response.send(dbResponse);
});

//GET the list of all names of people who follows the user
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserQuery = `
    SELECT 
      *
    FROM
      user
    WHERE 
      username = '${username}';
  `;
  const userDetails = await db.get(getUserQuery);
  const userId = userDetails.user_id;
  const getFollowersQuery = `
    SELECT 
      user.name
    FROM user 
    INNER JOIN follower ON follower.follower_user_id = user.user_id 
    WHERE follower.following_user_id = ${userId};
  `;
  const dbResponse = await db.all(getFollowersQuery);
  response.send(dbResponse);
});

//Get Tweets with Likes and Replies Count
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const username = request.username;
  const getUserQuery = `
    SELECT 
      *
    FROM
      user
    WHERE 
      username = '${username}';
  `;
  const userDetails = await db.get(getUserQuery);
  const userId = userDetails.user_id;
  const followingUsersQuery = `
    SELECT 
      user.user_id 
    FROM  user 
    INNER JOIN follower ON user.user_id = follower.following_user_id 
    WHERE follower.follower_user_id= ${userId};
  `;
  const dbResponse = await db.all(followingUsersQuery);
  let followingUsersIds = [];
  dbResponse.map((obj) => followingUsersIds.push(obj.user_id));
  const getTweetQuery = `
    SELECT 
      *
    FROM
      tweet
    WHERE 
      tweet_id = ${tweetId};
  `;
  const tweetDetails = await db.get(getTweetQuery);
  if (followingUsersIds.includes(tweetDetails.user_id)) {
    const tweetReplyQuery = `
          SELECT 
            COUNT(tweet.tweet_id) AS repliesCount
          FROM tweet 
          INNER JOIN reply ON tweet.tweet_id = reply.tweet_id 
          WHERE tweet.tweet_id = ${tweetId};
    `;
    const replies = await db.get(tweetReplyQuery);
    const tweetLikesQuery = `
          SELECT 
            COUNT(tweet.tweet_id) AS likesCount
          FROM tweet 
          INNER JOIN like ON tweet.tweet_id = like.tweet_id 
          WHERE 
            tweet.tweet_id = ${tweetId};
    `;
    const likes = await db.get(tweetLikesQuery);
    const tweetCompleteDetails = {
      tweet: tweetDetails.tweet,
      likes: likes.likesCount,
      replies: replies.repliesCount,
      dateTime: tweetDetails.date_time,
    };
    response.send(tweetCompleteDetails);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

//Get List of Names who Liked User Tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const username = request.username;
    const getUserQuery = `
    SELECT 
      *
    FROM
      user
    WHERE 
      username = '${username}';
  `;
    const userDetails = await db.get(getUserQuery);
    const userId = userDetails.user_id;
    const followingUsersQuery = `
    SELECT 
      user.user_id 
    FROM  user 
    INNER JOIN follower ON user.user_id = follower.following_user_id 
    WHERE follower.follower_user_id= ${userId};
  `;
    const dbResponse = await db.all(followingUsersQuery);
    let followingUsersIds = [];
    dbResponse.map((obj) => followingUsersIds.push(obj.user_id));
    const getTweetQuery = `
    SELECT 
      *
    FROM
      tweet
    WHERE 
      tweet_id = ${tweetId};
  `;
    const tweetDetails = await db.get(getTweetQuery);
    if (followingUsersIds.includes(tweetDetails.user_id)) {
      const getUserNamesQuery = `
        SELECT 
          user.username
        FROM like 
        INNER JOIN user 
        ON like.user_id = user.user_id 
        WHERE 
          like.tweet_id = ${tweetId};
      `;
      const usersNames = await db.all(getUserNamesQuery);
      const usernamesList = usersNames.map((obj) => {
        return obj.username;
      });
      response.send(usernamesList);
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);
