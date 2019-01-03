const test = require('tape')
const Sync = require('./sync.js')
const {ObjectSyncProtocol, SET_PROPERTY, CREATE_OBJECT, CREATE_PROPERTY} = Sync

/*
 create object A as child of root with property x = 100
  */
test('basic',t => {
    const sync = new ObjectSyncProtocol()
    const root = sync.createObject()
    sync.createProperty(root,'id','root')


    const A = sync.createObject()
    sync.createProperty(A,'id','A')
    sync.createProperty(A,'x',100)

    sync.createProperty(root,'children',[])
    sync.setProperty(root,'children',[A])


    const graph1 = sync.dumpGraph()
    t.deepEquals(graph1, {
        root: {id: 'root', children: [A]},
        A: {id: 'A',x:100},
    })
    t.end()
})

/*
 * create object A with property x = 100
 * set x to 200
 * dump the history. shows create object, create prop, set prop
 */
test('history', t => {
    const sync = new ObjectSyncProtocol()
    const history = []
    sync.onChange((e)=>{
        const obj = { type:e.type}
        if(e.type === CREATE_PROPERTY || e.type === SET_PROPERTY) {
            obj.name = e.name
            obj.value = e.value
        }
        history.push(obj)
    })
    const A = sync.createObject()
    sync.createProperty(A,'id','A')
    sync.createProperty(A,'x',100)
    sync.setProperty(A,'x',200)

    t.deepEquals(history,[
        { type:CREATE_OBJECT},
        { type:CREATE_PROPERTY,name:'id',value:'A'},
        { type:CREATE_PROPERTY,name:'x',value:100},
        { type:SET_PROPERTY,name:'x',value:200},
    ])

    t.end()
})

/*
user A create object R with R.x = 100
sync
user B sets R.x to 200
sync
user A can see R.x = 200
*/
test('sync', t => {
    const A = new ObjectSyncProtocol()
    const B = new ObjectSyncProtocol()

    function sync(X,Y) {
        X.onChange(e => {
            console.log("client changed",e)
            if(e.type === CREATE_OBJECT) Y.createObject(e.id)
            if(e.type === CREATE_PROPERTY) Y.createProperty(e.object, e.name, e.value)
            if(e.type === SET_PROPERTY) Y.setProperty(e.object, e.name, e.value)
        })
    }
    sync(A,B)
    sync(B,A)

    const aR1 = A.createObject()
    A.createProperty(aR1,'id','R')
    A.createProperty(aR1,'x',100)

    t.deepEquals(A.dumpGraph(), { R: {id: 'R',x:100} })
    t.deepEquals(B.dumpGraph(), { R: {id: 'R',x:100} })


    const bR1 = B.getObjectByProperty('id','R')
    B.setProperty(bR1,'x',200)

    t.deepEquals(A.dumpGraph(), { R: {id:'R',x:200}})
    t.deepEquals(B.dumpGraph(), { R: {id:'R',x:200}})


    const aR2 = A.getObjectByProperty('id','R')
    t.equal(A.getPropertyValue(aR2,'x'),200)
    t.end()
})

/*
create object R with R.x = 100
set R.x = 200
check undo queue
undo it
check
redo it
check

*/

// test('undo',t => {
//     const undo = new UndoQueue()
//     undo.listen(sync)
//
//     const R = sync.createObject()
//     sync.createProperty(R,'x',100)
//     sync.setProperty(R,'x',200)
//     t.deepEquals(undo.dump(),[
//         {type:'CREATE_OBJECT'},
//         {type:'CREATE_PROPERTY',name:'x',value:100},
//         {type:'UPDATE_PROPERTY',name:'x',value:200},
//     ])
//
//     t.equals(sync.getPropertyValue(R,'x'),200)
//
//     undo.undo()
//     t.equals(sync.getPropertyValue(R,'x'),100)
//     undo.redo()
//     t.equals(sync.getPropertyValue(R,'x'),200)
// })


/*
* tree B follows changes to tree A. Add, set, delete some objects. Confirm tree B is still valid.

 */

// test('jsonview',t => {
//     const jsonview = new JSONView()
//     jsonview.listen(sync)
//
//     const R = sync.createObject()
//     sync.createProperty(R,'id','R')
//     sync.createProperty(R,'x',100)
//     sync.setProperty(R,'x',200)
//     const S = sync.createObject()
//     sync.createProperty(S,'id','S')
//     sync.createProperty(S,'x',300)
//     sync.createProperty(R,'children',[sync.getId(S)])
//
//
//
//     t.deepEquals(
//         jsonview.getJSONViewById('R'),
//         {
//             id:'R',
//             x:100,
//             children:[
//                 {
//                     id:'S',
//                     x:300
//                 }
//             ]
//         }
//     )
//
//     const T = sync.createObject()
//     sync.createProperty(T,'id','T')
//     sync.createProperty(T,'x',400)
//     sync.setProperty(R,'children',[sync.getId(S),sync.getId(T)])
//
//
//
//     t.deepEquals(
//         jsonview.getJSONViewById('R'),
//         {
//             id:'R',
//             x:100,
//             children:[
//                 {
//                     id:'S',
//                     x:300
//                 },
//                 {
//                     id:'T',
//                     x:400
//                 }
//             ]
//         }
//     )
//
//     sync.deleteObject(S)
//     sync.setProperty(R,'children',[sync.getId(T)])
//
//
//     t.deepEquals(
//         jsonview.getJSONViewById('R'),
//         {
//             id:'R',
//             x:100,
//             children:[
//                 {
//                     id:'T',
//                     x:400
//                 }
//             ]
//         }
//     )
//
//     t.end()
// })


/*
* coalesce a set of changes into a single ‘transaction’ which can then be submitted as a batch
 */

// test('coalesce',t => {
//     const sync = Sync.createSync()
//
//     const history = new History()
//     history.listen(sync)
//
//     const throttle = new Throttle()
//     throttle.listen(sync)
//
//     const A = throttle.createObject()
//     throttle.createProperty(A,'x',100)
//     throttle.pause()
//     throttle.setProperty(A,'x',101)
//     throttle.setProperty(A,'x',102)
//     throttle.setProperty(A,'x',103)
//     throttle.unpause()
//
//     t.deepEquals(throttle.dump(),
//         [
//             {type:CREATE_OBJECT, id:sync.getId(A)},
//             {type:CREATE_PROPERTY,name:'x',value:100},
//             {type:SET_PROPERTY,name:'x',value:103}
//         ]
//     )
//     t.end()
// })



/*
 * record a sequence of changes while disconnected.
 * Reconnect and sync without conflicts.
 * Confirm that the final tree snapshot is correct.
 */

// test('disconnected',t => {
//     const Server = Sync.createSync()
//     const A = Sync.createSync()
//     const B = Sync.createSync()
//
//     Server.listen(A)
//     Server.listen(B)
//     A.listen(Server)
//     B.listen(Server)
//
//     const R = A.createObject()
//     A.createProperty(R,'x',1)
//
//     // all sides have the same value
//     t.equal(A.getPropertyValue(A.getObjectById(A.getId(R)),'x'),1)
//     t.equal(Server.getPropertyValue(Server.getObjectById(A.getId(R)),'x'),1)
//     t.equal(B.getPropertyValue(B.getObjectById(A.getId(R)),'x'),1)
//
//     //disconnect A
//     A.disconnect()
//     A.createProperty(R,'y',20)
//     A.setProperty(R,'x',2)
//
//     // sides have different values
//     t.equal(A.getPropertyValue(A.getObjectById(A.getId(R)),'x'),2)
//     t.equal(Server.getPropertyValue(Server.getObjectById(A.getId(R)),'x'),1)
//     t.equal(B.getPropertyValue(B.getObjectById(A.getId(R)),'x'),1)
//
//     t.equal(A.getPropertyValue(A.getObjectById(A.getId(R)),'y'),20)
//     t.equal(Server.hasPropertyValue(Server.getObjectById(A.getId(R)),'y'),false)
//     t.equal(B.hasPropertyValue(Server.getObjectById(A.getId(R)),'y'),false)
//
//     //dump the local storage
//
//     //
//     A.connect()
//
//     // all sides have the same value
//     t.equal(A.getPropertyValue(A.getObjectById(A.getId(R)),'x'),2)
//     t.equal(Server.getPropertyValue(Server.getObjectById(A.getId(R)),'x'),2)
//     t.equal(B.getPropertyValue(B.getObjectById(A.getId(R)),'x'),2)
//     // all sides have the same value
//     t.equal(A.getPropertyValue(A.getObjectById(A.getId(R)),'y'),20)
//     t.equal(Server.getPropertyValue(Server.getObjectById(A.getId(R)),'y'),20)
//     t.equal(B.getPropertyValue(B.getObjectById(A.getId(R)),'y'),20)
// })

// set property on a deleted object. Confirm that the final tree snapshot is correct.
// test('invalid property setting',t => {
//     const sync = new Sync()
//
//     const R = sync.createObject()
//     sync.createProperty(R,'id','R')
//     sync.createProperty(R,'x',100)
//     sync.setProperty(R,'x',200)
//     t.deepEquals(sync.dump(),{
//         R: {
//             id:'R',
//             x:200
//         }
//     })
//     sync.deleteObject(R)
//     sync.setProperty(R,'x',300)
//     t.deepEquals(sync.dump(),{})
// })