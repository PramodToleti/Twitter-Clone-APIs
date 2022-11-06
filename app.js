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
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const addUserQuery = `
        INSERT INTO 
          user(username, password, name, gender)
        VALUES (
          '${username}',
          '${hashedPassword}',
          '${name}',
          '${gender}'
        );
      `;
      const dbResponse = await db.run(addUserQuery);
      const userId = dbResponse.lastID;
      //console.log(userId);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//User Login API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const checkUserQuery = `
        SELECT 
          *
        FROM
          user
        WHERE 
          user.username = '${username}';
    `;
  const dbResponse = await db.get(checkUserQuery);
  if (dbResponse !== undefined) {
    const isPasswordChecked = await bcrypt.compare(
      password,
      dbResponse.password
    );
    if (isPasswordChecked === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "SECRET_TOKEN");
      response.send({ jwtToken: jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
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

//Get user ID middleware
const getUserId = async (request, response, next) => {
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
  request.userId = userId;
  next();
};

//Get Latest tweets of people whom the user follows
app.get(
  "/user/tweets/feed/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const userId = request.userId;
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
  }
);

//Get list of all names of people whom the user follows
app.get(
  "/user/following/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const userId = request.userId;
    const getUsersQuery = `
    SELECT 
      user.name 
    FROM user 
    INNER JOIN follower ON follower.following_user_id = user.user_id 
    WHERE follower.follower_user_id = ${userId};
  `;
    const dbResponse = await db.all(getUsersQuery);
    response.send(dbResponse);
  }
);

//GET the list of all names of people who follows the user
app.get(
  "/user/followers/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const userId = request.userId;
    const getFollowersQuery = `
    SELECT 
      user.name
    FROM user 
    INNER JOIN follower ON follower.follower_user_id = user.user_id 
    WHERE follower.following_user_id = ${userId};
  `;
    const dbResponse = await db.all(getFollowersQuery);
    response.send(dbResponse);
  }
);

//Get Tweets with Likes and Replies Count
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { tweetId } = request.params;
    const userId = request.userId;
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
  }
);

//Get List of Names who Liked User Tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { tweetId } = request.params;
    const userId = request.userId;
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
    if (tweetDetails === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
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
        response.send({ likes: usernamesList });
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    }
  }
);

//Get Reply Details of a tweet
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { tweetId } = request.params;
    const userId = request.userId;
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
      const repliesDetailsQuery = `
        SELECT 
          user.name,
          reply.reply 
        FROM reply 
        INNER JOIN user 
        ON user.user_id = reply.user_id 
        WHERE reply.tweet_id = ${tweetId};
      `;
      const repliesDetails = await db.all(repliesDetailsQuery);
      response.send({ replies: repliesDetails });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//Get list of all tweets of the user
app.get(
  "/user/tweets/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const userId = request.userId;
    const userTweetsQuery = `
    SELECT 
      tweet.tweet,
      tweet.date_time,
      tweet.tweet_id
    FROM tweet 
    INNER JOIN user 
    ON user.user_id = tweet.user_id 
    WHERE 
      user.user_id = ${userId};
  `;
    const userTweets = await db.all(userTweetsQuery);
    const userTweetsDetails = [];
    for (let obj of userTweets) {
      const tweetReplyQuery = `
          SELECT 
            COUNT(tweet.tweet_id) AS repliesCount
          FROM tweet 
          INNER JOIN reply ON tweet.tweet_id = reply.tweet_id 
          WHERE tweet.tweet_id = ${obj.tweet_id};
    `;
      const replies = await db.get(tweetReplyQuery);
      const tweetLikesQuery = `
          SELECT 
            COUNT(tweet.tweet_id) AS likesCount
          FROM tweet 
          INNER JOIN like ON tweet.tweet_id = like.tweet_id 
          WHERE 
            tweet.tweet_id = ${obj.tweet_id};
    `;
      const likes = await db.get(tweetLikesQuery);
      const tweetDetails = {
        tweet: obj.tweet,
        likes: likes.likesCount,
        replies: replies.repliesCount,
        dateTime: obj.date_time,
      };
      userTweetsDetails.push(tweetDetails);
    }
    response.send(userTweetsDetails);
  }
);

//Create Tweet API
app.post(
  "/user/tweets/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { tweet } = request.body;
    const userId = request.userId;
    const postTweetQuery = `
    INSERT INTO
      tweet(tweet, user_id)
    VALUES
      ('${tweet}', ${userId});
  `;
    const postTweet = await db.run(postTweetQuery);
    const tweetId = postTweet.lastID;
    //console.log({tweetId: tweetId});
    response.send("Created a Tweet");
  }
);

//Delete a tweet API
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    let { tweetId } = request.params;
    tweetId = parseInt(tweetId);
    const { tweet } = request.body;
    const userId = request.userId;
    const userTweetsQuery = `
        SELECT 
          tweet_id
        FROM 
          tweet
        WHERE 
          user_id = ${userId};
    `;
    const userTweetsResponse = await db.all(userTweetsQuery);
    const userTweetsIds = [];
    for (let obj of userTweetsResponse) {
      userTweetsIds.push(obj.tweet_id);
    }
    if (userTweetsIds.includes(tweetId)) {
      const deleteTweetQuery = `
        DELETE FROM 
            tweet
        WHERE
          tweet_id = ${tweetId};
      `;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
