
# Project Goal

## What is it

Graph Sync is a data syncing algorithm and an implementation in JavaScript. It is
independent of any framework, independent of the transport protocol, and supports
disconnected use. 

Graph Sync is based on conflict free replicated data-types (CRDTs), 
though less rigorously defined (see the TODOs). It lets you sync a data structure
between multiple hosts that may be constantly disconnecting from the network, have
large latency, or be offline for long periods of time. It does it's best to
be eventually consistent but at any time the graph might be in an inconsistent state
between peers.

Graph Sync can be peer to peer. It does not require or assume a central source of truth,
though in practice that is quite useful.

Graph Sync provides a protocol and syncing algorithm definition in addition to the 
javascript implementation. The goal is for a non-expert programmer to be able
to build  his/her own implementation in the language of their choice solely from
the algorithm description. 

Above all Graph Sync aims to be minimal, simple, and *practical*. If it's too hard for other
developers to use then we've failed.


## What can I do with it?

Fundamentally Graph Sync just syncs a list of maps and arrays which can
be assembled into tree or graph structures as desired. It's great for any
application where two or more instances need to sync data without conflicts. 

You could make a todo list that syncs with a server and several devices. A visual
editor that lets a hundred people edit simultaneously. A visual editor
that you can use offline. Collecting and merging logs from phones that
are often disconnected.  The uses are up to you.

## What does it not do?

Graph Sync is just the datastructure and syncing algorithm. It does not provide
transport. It's up to you, the developer, to push the operations over the network,
on to disk, into local storage, etc. There is example code which uses browser
local storage and pubnub for a simple syncing example, but you could easily use
websockets, raw sockets, UDP, http post, or anything else you want.


Graph Sync is not good for large text documents.  The array syncing system is 
potentially unbounded, meaning the history of your document could grow very large.
This is made worse with lots of array manipulations (like repeatedly reordering a list or
editing long paragraphs). There are more complex algorithms in the research
literature which could address these deficiences, but they are not the focus of
this project.

The library core does not include event coalescing, undo/redo, and other features
that you might want to build on top of the library, but there are some examples
which show you how to do it. 

## How does it work (highlevel)

Fundamentally Graph Sync just syncs a list of maps and arrays which can
be assembled into tree or graph structures as desired. Syncing is done by
sending a list of changes to the graph from one instance to another. These
changes are defined as one of about 10 simple operations that can be applied
at the other end(s) in any order, producing the same graph.  

All operations and objects within the graph have universal unique IDs so that 
one instance can refer to an object in the graph and all other instances will 
refer to the same thing.


## What flaws does it have?

First, Graph Sync has a *horibble name* and *bad speling*. Second it has not
been mathematically proven. Though based on CRDT concepts and research papers
I am not a mathematican and cannot *prove* it is conflict free. However it has
lots of unit tests and I'm trying to shake out the bugs. We'll see how it goes.

Next: the underlying API for graph sync is the processing of *operations*.  This makes
it clear how to build your own implemenation, but makes the API very annoying to use.
It really needs a higher level abstraction on top that is easier to use.

## Todos


* define algorithm in a way someone else could copy it
* explain how to order SET_PROPERTY operations
* make set property respect timestamps for ordering
* add examples for undo queue, coalescing multiple sets, throttling, 
* add example for using websockets
* add implementation in another language (Rust?)
* move history view to examples
* convert to ES6 module in a way that NodeJS can still use
* re-implement DocGraph as a simple proxy
* graph supports inserting and deleting array elements by id and index. remove index version
* does the main structure really need a history buffer? that should be delegated to a wrapper?
* better GUID generator?
* make errors in ObjectSyncProtocol.process throw real errors. Validator should have caught them earlier
* find a faster way to skip operations we've already processed

## Discussion and low level details

An object is a unique global ID attached to a list of properties. Two objects with the same properties but different GUIDs are different. A property is a key value pair. The key is unique within the parent object. The value is some typed value. It does not have a global ID. Two properties with the same key value are the same. 

A tree can be represented by a traditional object graph or as an ordered sequence of operations that modify the tree. There are the following operation types. 

* Create object
* Delete object
* Add property key and value
* Set property value
* Remove property key and value

That is it. With these it is enough to create a tree structure from the history of operations of the tree. By tracking changes we can have one-way update to other structures like:

* a general tree view
* a full operation history
* an undo/redo stack showing semantic changes
* realtime sync between multiple users
* store everything in offline localStorage and sync with server once reconnected
* a panel showing generated JSON
* coalesce changes that occur close to each other. Ex: property X is changed five times in less than 1 sec, or during a ‘transaction’ , becomes a single change.

Such a system has a few flaws, however.

* what defines which is the root node. It is special in some way. Perhaps we don’t care. The app can decide what is the root node, and multiple roots are possible as long as the graph is a proper DAG

* the list of children of a tree node is represented as a ‘children’ property which has a value of an array of object IDs. Since property updates are atomic there is no way to represent rearranging the order of children. There will simply be a new array overwriting the old one. This is fine for small lists of children, but if a node had, say, 100 children, then replacing the array with a new one becomes a very inefficient way to represent a reordering or insert.
* as with the children case, this does not represent *updates* to arrays efficiently, which means that this is a poor data structure for representing long sequences of text. It will be fine for short strings like the title of a document, but it is poor for paragraphs of body text. There will not be a good way to resolve conflicts between multiple users. Perhaps a future version of this structure could address the issue, but for now it is a problem we won’t solve.


The answer to these is to make arrays a first class citizen.  an object property may point to an array. an array contains references to objects.  This expands the number of operations we need to include:

* create array
* insert element
* delete element
* delete array


### Conflict resolution

Graph Sync takes advantage of the fact that most operations *won't* conflict. Two humans who are communicating with each other usually edit different parts of the document, so they won't produce any conflicts. There will be no conflicts is user A changes property X of object R while user B changes property Y of object S. If both try to change the same property at the same time then we can just say the last one wins.  How we define 'last' is the tricky part.
 
Another potential conflict is if one user edits a property of an object while another user deletes that object. In this case the the order does not matter. We can say that *invalid updates are ignored*. Editing the property of an object which does not exist can be ignored. However, to support undo, it makes more sense for objects to be marked as deleted and put into the trash instead of actually removed. Then the property update can proceed as designed regardless of the order of operations. There is nothing wrong with setting a property on an object marked deleted.

Offline support for one user is easy. The app records the stream of updates into local storage. Once reconnected they are sent to the server and marked as processed.  The trickier part is conflicts when the user reconnects.  Again we should say that the last one wins.  The hard part, again, is defining *last*. 

Consider this scenario: user A goes offline then edits object X. Later user B edits object X while online. Later still user A goes online and syncs.  Should object X reflect B’s edits, since they were edited by the human last, or should they represent A’s edits since they were the synced last?

There is no general answer to the question of which option is *semantically* correct. It depends entirely on the particular application. Some conflicts can be resolved automatically but some may simply require a human to make a decision. The critical part is to make sure the human has the information required to make these decisions. The UI should show the outcome of the different choices. The UI should only show options that the human could reasonably decide about. The design of this system will not eliminate all possibly human mediated conflicts, but it should minimize them, while remaining easy to implement.  Most importantly, Graph Sync's algorithm ensures that the graph is structurally consistent after a sync, even if semantically there are problems. 

Syncing arrays is a different case than syncing objects. Suppose arrays are just properties on an object. If A adds a child to R and B adds a child to R while disconnected, then they sync, then R will end up with only one child instead of two. This simply won't work. Instead R has a property which is a reference to an array structure with it's own operations for inserting and deleting.

When merging array insert and delete operations it should then be possible to include user *intent*.  If two users add to the children of the root, then they were both meant to be added and we can merge them. If one user adds to an array at the end and the other removes something in the middle, we can reasonably merge those operations.  We do get into some tricky spots with multiple edits and deletes that are near each other. Our goal is always to preserve user intent, so we must include both an index and an ID for *every element in the array*. Then if we delete the 3rd element and insert at the 3rd element, those two won’t be confused because they will refer to different element ids. This implies, however, that all contents of arrays must be objects.  

Now we have our final Array definition. There are four operations you can do on an array

* create array, returns ID
* insert(ID, prev element id, object id)
* remove(ID, element id  object id)
* delete array (ID)

An array is a list of elements. Each element is:
 
``` javascript
element {
    id:  UUID,
    value: object ID,
    prev: UUID,
    deleted: boolean,
}
```

Each element has a reference to the previous element, thus arrays are really more like linked lists.  This is the magic which enables conflict free merging. Each element has an id for itself and an id for the previous element, *even if that one has been deleted*. 

Consider this example:  A wants to insert at index 3. B has just deleted at index 1.  In a traditional array A will insert at what used to be position 4 because B's delete slide index 3 down to index 2. This probably isn't what A wanted. Instead A inserts after the element of index 3. Then no matter what B does A's insert will still be after whatever was at index 3, even if that is now at index 2 or 4.  

So how do we handle the case where B deleted the element A is trying to insert after? Simple. We never really delete anything.  The element is marked as deleted so that the apps don't try to use it anymore, but it still exists in the array so other inserts (possibly created offline prior to the deletion) will still work correctly.

Ordering is still a question. For example, if two disconnected operations come in to insert an element at the same location, how do we know what order to put them in?   When inserting an element we always record the local timestamp of when it was put in. When inserting a new element T between R and S check the timestamps. If T.ts > S.ts then the final version is R T S.  If T.ts <= S.ts then the final version is R S T. It doesn’t matter if the two sides are off on their timestamps as long as they are consistently off. 


### Server syncing

The syncing protocol does not require there to be a ‘server’. Syncing could happen between two or more users in a peer to peer manner. However, semantically many people are comfortable with the idea of a server somewhere acting as the single point of truth, provided it doesn’t slow things down or prevent disconnected editing.  Thus the server should be able to provide an authoritative view of the document as well as a replay of its history. Most importantly the server does *not* resolve conflicts, because a human is not present to solve those. Conflicts *must be* resolved on a client with a human. This means the server should be able to hold operations in a queue that have not been committed until a user says they are fully processed.  A new user might get a snapshot of the tree and a list of pending edits.

### Undo / Redo

One key to making the syncing work is that we *never* rewrite history. Once an operation is made we can never ‘go back in time’ to undo it. Instead an undo is done by applying a reverse operation. These operations are then applied like any others in the present, not the past. This does introduce some complications which must be dealt with by the client.

* the client must track a local undo/redo state
* the client must be able to generate undo/redo operations programmatically, though in practice this is not hard.
* what happens if user A edits object X, user B deletes object X, then user A undoes the operation.  This is easy. It is taken care of in the same way as the disconnected scenario. The operation is either applied or ignored. Alternatively, the UI for A may chose to warn A about the issue with the change. But this is entirely domain dependent and up to the UI. It does not affect the protocol.
* should user A be able to undo edits from user B? ie: should there be a single undo/redo stack.  This is up to the application, but in general the answer is no. Since there will be disconnected usage each user really needs their own undo / redo queue. It is also not clear how the UI would be presented if there was a shared queue. Would A have to undo B’s changes to get back to earlier changes from A? Even if B’s changes had nothing to do with A’s?  
* Instead we should ask *why* we would want a shared queue and just how far back the queue should go. Just because it is possible to undo all the way back to an empty document *doesn’t mean it’s a good idea*.  One of the overriding principles of this system is that automatic syncing and conflict resolution *does not replace communication between humans*. If two people are editing a doc together they should be talking to each other as well. If user A does a lot of work on object X then user B comes along and deletes it entirely then no conflict resolution system will find a correct way to address this. A and B have to actually talk together to decide what was the right course of action. *Syncing does not replace human communication*.
* As a collorary to above, it may be desirable under certain circumstances to be able to undo part of the history of a document separate from the user’s local undo stack.  This would handle the case where B accidentally deleted object X and A decides that was a bad idea and wants to revert it but B isn’t available. Instead of stopping work A can go back through the full document history (which is a superset of A’s undo stack), find object X, and undelete it. As with everything else this does not change anything in the past. Instead it adds a new operation to undelete the object.  This would probably be exposed in the UI as a /history/ view rather than /undo-redo/
* as an additional rule, a client should locally resolve conflicts with remote changes when reconnecting before submitting their own changes to the server. 



# Unit Tests
In order to have faith in both the algorithm design and the implementation we need *copious* unit tests that do not assume any particular transport or operating environment. Instead there is a service object which accepts actions from the outside and can provide a current state snapshot.

Cases to test
* A creates object X and B creates object Y, both added to children of object Z
* A sets property R then connects. A change from B to property R comes in, is resolved, then A’s change is applied.
* tree B follows changes to tree A. Add, set, delete some objects. Confirm tree B is still valid.
* queue Q follows history of changes to tree T. Shows the entire history;
* queue Q follows history of changes to tree T, shows only the changes from user A
* queue Q generates undo variants of a sequence of changes to tree T
* introduce two changes to an array value of a property. Produce a conflict definition that the user can choose from. Apply the conflict resolution. Produce a final tree snapshot that is correct.
* set property on a deleted object. Confirm that the final tree snapshot is correct.
* record a sequence of changes while disconnected. Reconnect and sync without conflicts. Confirm that the final tree snapshot is correct.
* record a sequence of changes with undos, undo the sequence of changes. Confirm that the final tree snapshot is correct.
* coalesce changes to two different properties when closer than 1sec apart. Confirm the history shows only the merged versions.
* coalesce a set of changes into a single ‘transaction’ which can then be submitted as a batch
* record all changes from a tree over 1 sec as a single batch of changes




## API design
The api is designed at multiple levels. At the core is the syncing algorithm which accepts and produces operations.  It does the core work of maintaining the data structure, however it is too low level to use directly. Instead most developers will use the DocumentGraph API which gives you a nicer graph structure to work with.  It has addons for tracking the history of a document, publishing changes to a transport (web sockets, pubnub, disk, etc), generating a JSON view, handling undo/redo, and others.  


Core api:  ObjectProtocol:
``` javascript
const A = new ObjectProtocol()
const B = new ObjectProtocol()
A.onChange(e => B.applyEvent())
const evt1 = {} //some event
A.applyEvent(evt1)
t.deepEquals(A.dumpGraph(),B.dumpGraph())
```

To have a reasonable API, use the document graph

```javascript
const doc = new DocumentGraph({title:"root", children:[]})
doc.getRoot() // returns {title:'root', children:[]}
const ch1 = doc.createObject({foo:'bar'})
doc.getRoot().get('children').push(ch1)
doc.getRoot().get('children').forEach(ch => console.log(ch))
doc.getRoot().get('title') === 'root'
doc.getRoot().set('title','tree root')
```

To use Undo/Redo

```javascript
const doc = //create a document
const stack = new UndoRedoStack(doc)
console.log(stack.canUndo(),stack.canRedo())
stack.canUndo() === false
doc.getRoot().get('children').push(ch2)
doc.getRoot().get('children').length === 1
stack.canUndo() === true
stack.undo()
doc.getRoot().get('children').length === 0
stack.canUndo() === false
stack.canRedo() === true
```

To sync to the network via PubNub do

```javascript
const doc = //create a document
const settings = // pubnub network and channel settings
const net = new PubNubDocument(doc, settings)
doc.getRoot().set('foo','bar') // propagated over the network
net.isConnected() === true
net.disconnect() 
net.isConnected() === false
doc.getRoot().set('baz','qux') // kept in history, not propagated
net.connect() // now the history is sent over the network
```

To show the history

```javascript
const doc = //create document
const hist = new HistoryView(doc)
//print each event on change
hist.on('change',(e)=>console.log("event",e))
```

To show the doc as a JSON object

```javascript
const doc = //create document
const jsonview = new JsonView(doc)
//print full json doc on every change
jsonview.on('change',(e)=>console.log(jsonview.getView())) 
```

To do coalescing wrap with a CoalescingGraph
```javascript
const doc = //create document
const view = new CoalescingGraphView(doc)
//now do all manipulation through view
view.startTransaction()
//these do not update the underlying document
view.getRoot().set('x',1)
view.getRoot().set('x',2)
view.getRoot().set('x',3)
view.endTransaction()
//now the underlying doc is updated
//now doc only gets a single event for x = 3
``` 

——————


## Syncing challenges

One of the challenges of data syncing is how to start. Assume there is not an existing document. Two clients are in the same channel. The first client, A, creates a node to be the root of the document.  B receives the notification of the document creation. How does it know that this is to be the root?  A standard ID?

When A sends an update to B, B will apply it locally, then fire events to everything in B’s environment sees it. However, we don’t want this to fire back to A. B’s environment needs to know if an update came from internal sources or is merely syncing from an external source. Instead of calling lots of functions we should have Graph.performRemoteAction() which will accept a remote action and still fire the events, but not 

We also need to handle the case where events arrive out of order.
For now we can try to execute an operation. If it doesn’t succeed put it in a queue. If another event comes in with an earlier count but the same host, then try that event then the original again.

=======

If an element is inserted into an array before the array is created, then this is an out of order issue. We can put it into the wait buffer and try again after the array is created.  If the element is an object ref and the object hasn’t been created, then is also an out of order issue, the solution is the same. Wait buffer.

The challenge is that the value of an /insert_element/ operation could be an object reference or a straight value. We don’t currently know. Is this a problem? Is it allowed to insert a reference to an invalid object into an array, hoping that the object is created before anyone tries to access it. Alternatively we could tag the reference in some way so that we know it is an object reference, then the process could to catch it and wait for the right one.  I’m not sure of the correct solution yet.



## data flow design for a real application

There are a bunch of interlocking systems that have to work in a visual editor. The underlying datastore is used for all of the following:
* realtime drawing during interaction (ex: dragging a rectangle)
* undo/redo of semantic actions
* saving document to local storage
* saving document to remote storage
* preserving document while offline
* syncing document to other concurrent editors

To make all of this work we need a series of graph objects connected together. Most of them don’t actually hold the graph, but merely control views into the true graph. They provide access to different views of the graph that different parts of the application need in order to do their job.  This means the way data flows between them is very important.


#### examples

The provider should manage all updates to the views. The views call onRawChange to get prop events from mouse drags. Other views call onGraphChange to get larger semantic events.  They only need to register once. When the doc is swapped out that is purely internal to the provider.
The provider has additional state for:
* connected/disconnected
* canundo/canredo


# Additional Flaws Found

## element in the same array multiple times

We cannot use the id of the current element’s value because a given value could appear in the array more than once.  Instead we have an element object which contains an ID and a value, and the marker for if it has been tombstoned (deleted).  It is this element object that we use as the reference ID.

## using created objects

An object consists of an ID and a set of properties. When an object is created it is often done with multiple calls, one for creating the object and several for adding the properties.  The problem is that the operation for the initial object creation may be dispatched and processed by others before all of the properties are created. Thus we have an incomplete object and the graph will be physically intact but have logical errors. Ex: Rectangle object must have an `width` property, but could be used before this property exists.

### possible solutions

* create object operation can create properties as well. Thus the minimum set of properties needed to make the object ‘complete’ can be included with the creation. Creating a complete object then becomes a single operation and is therefore /atomic/ . This feels like a kludge but would probably work, at least for smaller objects.
* create a grouping mechanism. All operations in a group must be received and processed atomically. This is like an SQL transaction. The problems are that, first, the group must count the members of the group and use some sort of local sequencing mechanism so that the receivers can wait for the whole group to arrive before processing it. The receiver still has to deal with how to present it’s own listeners with only the complete object. Event pausing, perhaps?  This may also present long term performance issues much as SQL transactions do.
* create a dependency operation which says that receivers must stop processing and buffer until certain previous operations have arrived, specified as a list of unique IDs of the operations. This is another form of the transaction solution but might have other uses as signals.

## Cut Copy Paste

Cutting is fairly easy. Remove the object from its parent. Save its ID in the clipboard. Because all objects exist in the graph whether or not they are attached to anything the object will stick around.

Pasting is easy too. Just insert the object by ID wherever you want.

Copy. Copy is harder. We have to clone the object because we want to leave it in place but also put a copy somewhere else. It makes sense to save a reference to the ID in the clipboard and then clone when it is later pasted.  Cloning should be deep, meaning the object gets new properties as well (or at least no shared IDs).  If the object has sub-objects then those should also get cloned.

This brings up an interesting question.  We are cloning when we paste.  Does this happen always or only when we paste after a copy.  Paste after a cut should be the same as moving, right?   Does it actually make a difference if we delete and insert a copy vs the original?  

Actually it does. The clone does not have the history of the original. If we later add some sort of tracking it can’t ‘follow’ easily the pasted version from the original version.  If we merge in a SET_PROPERTY on the original, does it get applied to the copy?  We could make it work like that, but then what happens if did a cut then pasted eight times? Do all eight receive the update? Just the first?

To keep things simple I think cut and copy will both save the ID and paste will *always* clone. This keeps things consistent.   Thus /cut/ followed by /paste/ is *not* the same as /move/



